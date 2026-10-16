import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E menu "Binary Logistic (Experiment)" pada production build:
 * - Run once di keempat mode → beta & S.E. identik (< 1e-8), termasuk dummy kategorik
 * - Compare with production → cocok dengan Enter produksi (< 1e-4)
 * - Batch kecil → selesai, akurasi < 1e-8, CSV per run + meta.json
 * - OK di keempat konfigurasi (D, lalu A, B, C di dialog baru) → tiap laporan
 *   SPSS IDENTIK dengan dialog Binary Logistic produksi (data, variabel, dan
 *   opsi default yang sama), catatan kartu menyebut konfigurasinya, dan kartu
 *   eksperimen berisi performa run OK tersebut
 * - Smoke test dialog Binary Logistic produksi (satu run Enter)
 * - Tidak ada error console/pageerror dari kode aplikasi
 *
 * Dataset: fixtures/bl_experiment_small.csv (303 baris; 3 baris tidak lengkap
 * → N = 300 setelah listwise deletion). Kolom grp (teks: low/mid/high) diimpor
 * sebagai nominal → kategorik Indicator (Last): urutan high, low, mid → referensi mid.
 */
const FIXTURE = path.join(__dirname, "fixtures", "bl_experiment_small.csv");
const COVARIATES = ["x1", "x2", "x3", "grp"];
const FEATURES = ["Constant", "x1", "x2", "x3", "grp(1)", "grp(2)"];
const MODES = ["A", "B", "C", "D"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABELS: Record<Mode, string> = {
  A: "A. JavaScript – Main thread",
  B: "B. JavaScript – Web Worker",
  C: "C. Rust-Wasm – Main thread",
  D: "D. Rust-Wasm – Web Worker",
};
const SPSS_TITLE = "Binary Logistic Regression";
const EXPERIMENT_TITLE = "Binary Logistic (Experiment): 2×2 performance";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
  });
  return errors;
}

/** Buka menu bar sampai `visible` terlihat (klik sebelum hydration selesai bisa hilang). */
async function openMenu(page: Page, trigger: Locator, visible: Locator) {
  await expect(async () => {
    if (!(await visible.isVisible())) await trigger.click();
    await expect(visible).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function importFixture(page: Page) {
  await page.goto("/dashboard/data");
  await page.waitForLoadState("networkidle");
  await openMenu(page, page.getByTestId("file-menu-trigger"), page.getByTestId("file-menu-import-trigger"));
  await page.getByTestId("file-menu-import-trigger").click();
  await page.getByTestId("file-menu-import-csv").click();
  await page.getByTestId("dropzone-input").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("modal-title")).toHaveCount(0, { timeout: 30_000 });
}

async function openRegressionItem(page: Page, item: string) {
  await openMenu(page, page.getByTestId("analyze-menu-trigger"), page.getByRole("menuitem", { name: "Regression" }));
  await page.getByRole("menuitem", { name: "Regression" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Jumlah statistik per analytic berjudul `title` (urut id), dibaca langsung dari IndexedDB "Statify". */
function statisticsPerAnalytic(page: Page, title: string): Promise<number[]> {
  return page.evaluate(
    (t) =>
      new Promise<number[]>((resolve, reject) => {
        const req = indexedDB.open("Statify");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["analytics", "statistics"], "readonly");
          const analytics = tx.objectStore("analytics").getAll();
          const statistics = tx.objectStore("statistics").getAll();
          tx.oncomplete = () => {
            const ids = (analytics.result as { id: number; title: string }[])
              .filter((a) => a.title === t)
              .map((a) => a.id)
              .sort((a, b) => a - b);
            const stats = statistics.result as { analyticId: number }[];
            resolve(ids.map((id) => stats.filter((s) => s.analyticId === id).length));
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    title
  );
}

/**
 * Tunggu sampai `expectedAnalytics` analytic berjudul `title` ada dan jumlah
 * statistiknya tidak berubah selama 1,5 s (produksi menulis statistik satu per
 * satu; pindah halaman terlalu cepat akan memutus penulisan).
 */
async function waitForWrittenAnalytics(page: Page, title: string, expectedAnalytics: number) {
  let lastKey = "";
  let stableSince = 0;
  await expect
    .poll(
      async () => {
        const counts = await statisticsPerAnalytic(page, title);
        const key = JSON.stringify(counts);
        const now = Date.now();
        if (key !== lastKey) {
          lastKey = key;
          stableSince = now;
        }
        return counts.length === expectedAnalytics && counts.every((c) => c > 0) && now - stableSince >= 1500;
      },
      { timeout: 120_000, intervals: [250] }
    )
    .toBe(true);
}

const maxAbsDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Parser satu baris CSV (RFC 4180: field ber-kutip, "" sebagai kutip literal). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function readCoefficients(page: Page) {
  const read = (prefix: string) =>
    page.locator(`[data-testid^="${prefix}"]`).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))));
  return { beta: await read("bl-exp-coef-b-"), se: await read("bl-exp-coef-se-") };
}

async function selectProductionVariables(page: Page) {
  await page.getByTestId("binary-logistic-variable-item-y").click();
  await page.getByTestId("binary-logistic-move-to-dependent").click();
  for (const v of COVARIATES) {
    await page.getByTestId(`binary-logistic-variable-item-${v}`).click();
    await page.getByTestId("binary-logistic-move-to-covariates").click();
  }
}

async function selectExperimentVariables(page: Page) {
  await page.getByTestId("bl-exp-variable-item-y").click();
  await page.getByTestId("bl-exp-move-to-dependent").click();
  for (const v of COVARIATES) {
    await page.getByTestId(`bl-exp-variable-item-${v}`).click();
    await page.getByTestId("bl-exp-move-to-covariates").click();
  }
}

/** OK pada konfigurasi `mode`; dialog tertutup setelah analisis selesai dan output tertulis. */
async function runOk(page: Page, mode: Mode) {
  await page.getByTestId("bl-exp-tab-experiment").click();
  await page.getByTestId(`bl-exp-mode-${mode}`).click();
  await expect(page.getByTestId("bl-exp-ok-config")).toContainText(MODE_LABELS[mode]);
  await page.getByTestId("bl-exp-ok").click();
  await expect(page.getByTestId("bl-exp-dialog")).toHaveCount(0, { timeout: 120_000 });
}

/** Teks header komponen + output statistik sebuah kartu, urut DOM (tanpa judul dan catatan kartu). */
function cardOutputs(card: Locator): Promise<string[]> {
  return card.evaluate((el) =>
    Array.from(el.querySelectorAll('[data-testid^="component-header-"], [data-testid^="result-output-"]')).map(
      (e) => (e as HTMLElement).innerText
    )
  );
}

test("Binary Logistic (Experiment): 4 modes, production comparison, batch + CSV, OK in A/B/C/D", async ({ page }) => {
  const errors = collectErrors(page);
  await importFixture(page);

  await openRegressionItem(page, "Binary Logistic (Experiment)...");
  await expect(page.getByTestId("bl-exp-dialog")).toBeVisible();
  await expect(page.getByTestId("modal-title")).toHaveText("Binary Logistic (Experiment)");
  await expect(page.getByTestId("bl-exp-method-label")).toHaveText("Enter");
  await selectExperimentVariables(page);

  await page.getByTestId("bl-exp-tab-experiment").click();
  await expect(page.getByTestId("bl-exp-n-original")).toHaveText("300");
  await expect(page.getByTestId("bl-exp-coding-grp")).toContainText("high, low, mid (reference)");
  await expect(page.getByTestId("bl-exp-coding-grp")).toContainText("grp(1), grp(2)");

  // --- Run once di keempat mode ---
  const results: Record<string, { beta: number[]; se: number[] }> = {};
  for (const m of MODES) {
    await page.getByTestId(`bl-exp-mode-${m}`).click();
    await page.getByTestId("bl-exp-run-once").click();
    await expect(page.locator(`[data-testid="bl-exp-single-result"][data-mode="${m}"]`)).toBeVisible();
    await expect(page.getByTestId("bl-exp-run-once")).toBeEnabled();
    results[m] = await readCoefficients(page);
    expect(results[m].beta).toHaveLength(FEATURES.length);
    expect(results[m].beta.every(Number.isFinite)).toBe(true);
  }
  for (const m of ["A", "B", "C"]) {
    const db = maxAbsDiff(results[m].beta, results.D.beta);
    const ds = maxAbsDiff(results[m].se, results.D.se);
    console.log(`Run once ${m} vs D: max|Δβ| = ${db}, max|ΔSE| = ${ds}`);
    expect(db).toBeLessThan(1e-8);
    expect(ds).toBeLessThan(1e-8);
  }

  // --- Compare with production (Enter, termasuk dummy kategorik) ---
  await page.getByTestId("bl-exp-compare-production").click();
  await expect(page.getByTestId("bl-exp-production-status")).toBeVisible({ timeout: 120_000 });
  for (const m of MODES) {
    const d = Number(await page.getByTestId(`bl-exp-production-${m}`).getAttribute("data-max-diff"));
    console.log(`Production vs ${m}: max |Δ| = ${d}`);
    expect(d).toBeLessThan(1e-4);
  }

  // --- Batch kecil: N asli + 10.000, warm-up 1, ulangan 2 ---
  await page.getByTestId("bl-exp-size-50000").click();
  await page.getByTestId("bl-exp-size-100000").click();
  await page.getByTestId("bl-exp-warmup").fill("1");
  await page.getByTestId("bl-exp-repetitions").fill("2");
  await page.getByTestId("bl-exp-run-batch").click();
  await expect(page.locator('[data-testid="bl-exp-batch-result"][data-status="done"]')).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId("bl-exp-batch-chart")).toBeVisible();
  await expect(page.getByTestId("bl-exp-summary-table")).toBeVisible();

  const acc = await page
    .locator('[data-testid^="bl-exp-acc-beta-"]')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))));
  expect(acc).toHaveLength(2 * 4);
  console.log(`Batch accuracy max|Δβ| vs D = ${Math.max(...acc)}`);
  expect(Math.max(...acc)).toBeLessThan(1e-8);

  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bl-exp-download-csv").click()]);
  const csv = fs.readFileSync((await csvDownload.path())!, "utf8").trim().split(/\r?\n/).map(parseCsvLine);
  const header = csv[0];
  expect(csv).toHaveLength(1 + 2 * 2 * 4);
  for (const col of ["mode", "N", "computeMs", "e2eMs", "overheadMs", "maxFrameGapMs", "droppedFrames", "longTaskCount", "B_Constant", "B_grp(1)", "SE_grp(2)", "userAgent", "hardwareConcurrency", "crossOriginIsolated", "buildMode", "gitCommit"]) {
    expect(header).toContain(col);
  }
  const col = (row: string[], name: string) => row[header.indexOf(name)];
  for (const row of csv.slice(1)) {
    expect(row).toHaveLength(header.length);
    expect(col(row, "buildMode")).toBe("production");
    expect(col(row, "crossOriginIsolated")).toBe("true");
    expect(["A", "B", "C", "D"]).toContain(col(row, "mode"));
    expect(Number(col(row, "e2eMs"))).toBeGreaterThan(0);
  }
  console.log(`CSV: ${csv.length - 1} runs, gitCommit = ${col(csv[1], "gitCommit") || "(empty)"}`);

  const [metaDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bl-exp-download-meta").click()]);
  const meta = JSON.parse(fs.readFileSync((await metaDownload.path())!, "utf8"));
  expect(meta.status).toBe("done");
  expect(meta.orders).toHaveLength(2 * 2);
  expect(meta.environment.crossOriginIsolated).toBe(true);

  // --- OK di keempat konfigurasi: laporan SPSS + kartu performa ---
  // D di dialog ini (kartu eksperimen juga memuat Run once, batch, perbandingan), lalu A, B, C di dialog baru
  const okOrder: Mode[] = ["D", "A", "B", "C"];
  await runOk(page, "D");
  expect(await statisticsPerAnalytic(page, EXPERIMENT_TITLE)).toEqual([6]);
  for (const m of okOrder.slice(1)) {
    await openRegressionItem(page, "Binary Logistic (Experiment)...");
    await expect(page.getByTestId("bl-exp-dialog")).toBeVisible();
    await selectExperimentVariables(page);
    await runOk(page, m);
  }
  const ours = await statisticsPerAnalytic(page, SPSS_TITLE);
  expect(ours).toHaveLength(okOrder.length);
  expect(ours[0]).toBeGreaterThan(5);
  expect(new Set(ours).size).toBe(1);
  expect(await statisticsPerAnalytic(page, EXPERIMENT_TITLE)).toEqual([6, 1, 1, 1]);

  // --- Dialog Binary Logistic produksi dengan data & variabel yang sama ---
  await openRegressionItem(page, "Binary Logistic...");
  await selectProductionVariables(page);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect
    .poll(() => statisticsPerAnalytic(page, SPSS_TITLE), { timeout: 120_000 })
    .toEqual([...ours, ours[0]]);

  // --- Output viewer: keempat laporan SPSS eksperimen identik dengan laporan produksi ---
  await page.goto("/dashboard/result");
  const spssCards = page.locator('[data-testid^="result-analytic-"]').filter({
    has: page.locator('[data-testid^="analytic-title-"]', { hasText: new RegExp(`^${SPSS_TITLE}$`) }),
  });
  await expect(spssCards).toHaveCount(okOrder.length + 1, { timeout: 60_000 });
  const production = spssCards.nth(okOrder.length);
  for (const heading of ["Variables in the Equation", "Categorical Variables Codings", "Model Summary", "Classification Table"]) {
    await expect(production.getByText(heading, { exact: true }).first()).toBeVisible();
  }
  await expect(production.locator('[data-testid^="analytic-note-"]')).toHaveText("Method: Enter");
  const productionOutputs = await cardOutputs(production);
  expect(productionOutputs.join("\n").length).toBeGreaterThan(500);
  for (const [i, m] of okOrder.entries()) {
    const card = spssCards.nth(i);
    await expect(card.locator('[data-testid^="analytic-note-"]')).toHaveText(`Method: Enter · computed with ${MODE_LABELS[m]}`);
    expect(await cardOutputs(card), `SPSS output of OK ${m}`).toEqual(productionOutputs);
  }
  const logHeaders = await page
    .locator('[data-testid^="log-header-"]')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/^Log \d+:\s*/, "")));
  expect(logHeaders).toHaveLength(okOrder.length + 1);
  expect(new Set(logHeaders).size).toBe(1);

  // --- Kartu eksperimen: performa run OK per konfigurasi ---
  const experimentCards = page.locator('[data-testid^="result-analytic-"]').filter({
    has: page.locator('[data-testid^="analytic-title-"]', { hasText: EXPERIMENT_TITLE }),
  });
  await expect(experimentCards).toHaveCount(okOrder.length);
  for (const [i, m] of okOrder.entries()) {
    const card = experimentCards.nth(i);
    await expect(card).toContainText(`computed with ${MODE_LABELS[m]}`);
    // Judul statistik tidak dirender viewer; judul tabel yang terlihat menyebut konfigurasinya
    await expect(card).toContainText(`Analysis run performance – ${MODE_LABELS[m]}`);
    const perf = (await card.locator('[data-testid^="result-output-"]').first().innerText()).replace(/\s+/g, " ");
    const metric = (name: string) => perf.match(new RegExp(`${name} ([\\d.,]+)`))?.[1] ?? "?";
    expect(metric("computeMs")).not.toBe("?");
    console.log(
      `OK ${m}: computeMs = ${metric("computeMs")}, e2eMs = ${metric("e2eMs")}, maxFrameGapMs = ${metric("maxFrameGapMs")}`
    );
  }
  await expect(experimentCards.nth(0)).toContainText("Batch summary");
  await expect(experimentCards.nth(0)).toContainText("Experiment vs production");
  await expect(experimentCards.nth(0)).toContainText("PASS");
  console.log(`SPSS output of OK A/B/C/D identical to production (${productionOutputs.length} blocks); syntax: ${logHeaders[0]}`);

  console.log(`Console/page errors:\n${errors.join("\n") || "(none)"}`);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test("production Binary Logistic (Enter) still runs", async ({ page }) => {
  const errors = collectErrors(page);
  await importFixture(page);
  await openRegressionItem(page, "Binary Logistic...");
  await selectProductionVariables(page);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await waitForWrittenAnalytics(page, SPSS_TITLE, 1);

  await page.goto("/dashboard/result");
  await expect(page.getByText("Variables in the Equation").first()).toBeVisible({ timeout: 60_000 });

  console.log(`Console/page errors:\n${errors.join("\n") || "(none)"}`);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
