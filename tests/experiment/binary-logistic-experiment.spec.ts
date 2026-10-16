import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E menu "Binary Logistic (Experiment)" pada production build:
 * - Run once di keempat mode → beta & S.E. identik (< 1e-8)
 * - Compare with production → cocok dengan Enter produksi (< 1e-4)
 * - Batch kecil → selesai, akurasi < 1e-8, CSV per run + meta.json
 * - Smoke test dialog Binary Logistic produksi (satu run Enter)
 * - Tidak ada error console/pageerror dari kode aplikasi
 *
 * Dataset: fixtures/bl_experiment_small.csv (303 baris, 3 baris tidak lengkap
 * → N = 300 setelah listwise deletion), diimpor lewat File → Import Data → CSV.
 */
const FIXTURE = path.join(__dirname, "fixtures", "bl_experiment_small.csv");
const COVARIATES = ["x1", "x2", "x3"];
const MODES = ["A", "B", "C", "D"] as const;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
  });
  return errors;
}

async function importFixture(page: Page) {
  await page.goto("/dashboard/data");
  await page.getByTestId("file-menu-trigger").click();
  await page.getByTestId("file-menu-import-trigger").click();
  await page.getByTestId("file-menu-import-csv").click();
  await page.getByTestId("dropzone-input").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("modal-title")).toHaveCount(0, { timeout: 30_000 });
}

async function openRegressionItem(page: Page, item: string) {
  await page.getByTestId("analyze-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Regression" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
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

test("Binary Logistic (Experiment): 4 modes, production comparison, batch + CSV", async ({ page }) => {
  const errors = collectErrors(page);
  await importFixture(page);

  await openRegressionItem(page, "Binary Logistic (Experiment)...");
  await expect(page.getByTestId("bl-exp-dialog")).toBeVisible();
  await expect(page.getByTestId("modal-title")).toHaveText("Binary Logistic (Experiment)");
  await expect(page.getByTestId("bl-exp-method-label")).toHaveText("Enter");

  await page.getByTestId("bl-exp-variable-item-y").click();
  await page.getByTestId("bl-exp-move-to-dependent").click();
  for (const v of COVARIATES) {
    await page.getByTestId(`bl-exp-variable-item-${v}`).click();
    await page.getByTestId("bl-exp-move-to-covariates").click();
  }

  await page.getByTestId("bl-exp-tab-experiment").click();
  await expect(page.getByTestId("bl-exp-n-original")).toHaveText("300");

  // --- Run once di keempat mode ---
  const results: Record<string, { beta: number[]; se: number[] }> = {};
  for (const m of MODES) {
    await page.getByTestId(`bl-exp-mode-${m}`).click();
    await page.getByTestId("bl-exp-run-once").click();
    await expect(page.locator(`[data-testid="bl-exp-single-result"][data-mode="${m}"]`)).toBeVisible();
    await expect(page.getByTestId("bl-exp-run-once")).toBeEnabled();
    results[m] = await readCoefficients(page);
    expect(results[m].beta).toHaveLength(1 + COVARIATES.length);
    expect(results[m].beta.every(Number.isFinite)).toBe(true);
  }
  for (const m of ["A", "B", "C"]) {
    const db = maxAbsDiff(results[m].beta, results.D.beta);
    const ds = maxAbsDiff(results[m].se, results.D.se);
    console.log(`Run once ${m} vs D: max|Δβ| = ${db}, max|ΔSE| = ${ds}`);
    expect(db).toBeLessThan(1e-8);
    expect(ds).toBeLessThan(1e-8);
  }

  // --- Compare with production (Enter) ---
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
  for (const col of ["mode", "N", "computeMs", "e2eMs", "overheadMs", "maxFrameGapMs", "droppedFrames", "longTaskCount", "B_Constant", "SE_x3", "userAgent", "hardwareConcurrency", "crossOriginIsolated", "buildMode", "gitCommit"]) {
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

  // OK menulis ringkasan ke output viewer lalu menutup dialog
  await page.getByTestId("bl-exp-ok").click();
  await expect(page.getByTestId("bl-exp-dialog")).toHaveCount(0);

  console.log(`Console/page errors:\n${errors.join("\n") || "(none)"}`);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test("production Binary Logistic (Enter) still runs", async ({ page }) => {
  const errors = collectErrors(page);
  await importFixture(page);
  await openRegressionItem(page, "Binary Logistic...");

  await page.getByTestId("binary-logistic-variable-item-y").click();
  await page.getByTestId("binary-logistic-move-to-dependent").click();
  for (const v of COVARIATES) {
    await page.getByTestId(`binary-logistic-variable-item-${v}`).click();
    await page.getByTestId("binary-logistic-move-to-covariates").click();
  }
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("button", { name: "OK", exact: true })).toBeEnabled({ timeout: 120_000 });

  await page.goto("/dashboard/result");
  await expect(page.getByText("Variables in the Equation").first()).toBeVisible({ timeout: 60_000 });

  console.log(`Console/page errors:\n${errors.join("\n") || "(none)"}`);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
