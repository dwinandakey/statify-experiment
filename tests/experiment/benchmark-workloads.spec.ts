import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Runner benchmark (bukan bagian E2E biasa): beberapa batch dengan pengaturan dan
 * dataset yang SAMA, di sesi browser yang sama, lalu CSV dan meta.json tiap batch
 * disimpan (default: benchmark-results/ di root repo, di luar test-results/ yang
 * dikosongkan Playwright setiap run). Default-nya mereproduksi keempat batch
 * naskah: core + full, masing-masing dengan worker persistent dan per-run.
 * Analisis: reproducibility/ (REPRODUCE.md) atau scripts/compareWorkloads.mjs.
 *
 * Setiap entri EXPERIMENT_BENCH_WORKLOADS adalah workload ("core" atau "full"),
 * opsional dengan akhiran ":per-run" (alias ":cold"): Worker lifecycle "Per-run"
 * di dialog, yaitu worker baru untuk setiap run (kolom workerStart = cold,
 * lifecycle = per-run di meta.json). Tanpa akhiran: worker persistent (warm).
 * Berkas per-run disimpan dengan akhiran "-per-run". Runner ini (legacy, v1) selalu
 * memakai resample + urutan N naik; sesi v2 dijalankan tests/experiment/orchestrate.mjs.
 *
 * Dilewati kecuali EXPERIMENT_BENCH_DATA diisi. Contoh (PowerShell, dari root repo,
 * setelah production build):
 *   $env:EXPERIMENT_BENCH_DATA = "C:\data\HR-Employee-Attrition.csv"
 *   $env:EXPERIMENT_BENCH_OUT = "C:\data\bench-out"   # opsional
 *   $env:EXPERIMENT_BENCH_CHANNEL = "chrome"   # Chrome terpasang, bukan Chromium Playwright
 *   $env:EXPERIMENT_PORT = "3002"
 *   npx playwright test -c tests/experiment/playwright.experiment.config.ts benchmark-workloads
 *
 * Default (batch HR Attrition artikel v1) ada di tests/experiment/bench.v1-hr.json
 * (EXPERIMENT_BENCH_CONFIG untuk berkas lain). Variabel berikut menimpanya:
 * EXPERIMENT_BENCH_DEPENDENT, EXPERIMENT_BENCH_COVARIATES (dipisah koma),
 * EXPERIMENT_BENCH_WORKLOADS (mis. "core,core:per-run,full,full:per-run"),
 * EXPERIMENT_BENCH_WARMUP, EXPERIMENT_BENCH_REPETITIONS, EXPERIMENT_BENCH_SEED. Ukuran N:
 * N asli + 10.000 + 50.000 + 100.000 (default dialog).
 */
const env = process.env;
interface LegacyConfig {
  dependent: string;
  covariates: string[];
  workloads: string[];
  warmup: number;
  repetitions: number;
  seed: number;
}
const CONFIG: LegacyConfig = JSON.parse(
  fs.readFileSync(env.EXPERIMENT_BENCH_CONFIG ?? path.join(__dirname, "bench.v1-hr.json"), "utf8")
);
const DATA = env.EXPERIMENT_BENCH_DATA;
const OUT = env.EXPERIMENT_BENCH_OUT ?? path.join(__dirname, "../../benchmark-results");
const DEPENDENT = env.EXPERIMENT_BENCH_DEPENDENT ?? CONFIG.dependent;
const COVARIATES = (env.EXPERIMENT_BENCH_COVARIATES ?? CONFIG.covariates.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
interface BatchSpec {
  workload: "core" | "full";
  perRun: boolean;
}
const BATCHES: BatchSpec[] = (env.EXPERIMENT_BENCH_WORKLOADS ?? CONFIG.workloads.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [workload, lifecycle = "persistent"] = entry.split(":");
    if (workload !== "core" && workload !== "full") throw new Error(`Unknown workload "${workload}" in "${entry}"`);
    if (!["persistent", "warm", "per-run", "cold"].includes(lifecycle)) throw new Error(`Unknown lifecycle in "${entry}"`);
    return { workload, perRun: lifecycle === "per-run" || lifecycle === "cold" };
  });
const WARMUP = env.EXPERIMENT_BENCH_WARMUP ?? String(CONFIG.warmup);
const REPETITIONS = env.EXPERIMENT_BENCH_REPETITIONS ?? String(CONFIG.repetitions);
const SEED = env.EXPERIMENT_BENCH_SEED ?? String(CONFIG.seed);

test.use({ channel: env.EXPERIMENT_BENCH_CHANNEL || undefined });

async function openMenu(trigger: Locator, visible: Locator) {
  await expect(async () => {
    if (!(await visible.isVisible())) await trigger.click();
    await expect(visible).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function importCsv(page: Page, file: string) {
  await page.goto("/dashboard/data");
  await page.waitForLoadState("networkidle");
  await openMenu(page.getByTestId("file-menu-trigger"), page.getByTestId("file-menu-import-trigger"));
  await page.getByTestId("file-menu-import-trigger").click();
  await page.getByTestId("file-menu-import-csv").click();
  await page.getByTestId("dropzone-input").setInputFiles(file);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("modal-title")).toHaveCount(0, { timeout: 60_000 });
}

async function save(page: Page, testId: string, suffix: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  // batch-X.csv → batch-X-per-run.csv, batch-X-meta.json → batch-X-per-run-meta.json
  const name = download.suggestedFilename().replace(/(-meta)?(\.\w+)$/, `${suffix}$1$2`);
  const target = path.join(OUT, name);
  await download.saveAs(target);
  return target;
}

test("benchmark: workloads and worker lifecycles with identical settings", async ({ browser, baseURL }) => {
  test.skip(!DATA, "Set EXPERIMENT_BENCH_DATA to run the workload benchmark.");
  test.setTimeout(90 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });
  // Playwright Test menerapkan userAgent device descriptor proyek ("Desktop Chrome",
  // string Chromium bawaan) juga ke context manual; pakai UA asli dari CDP supaya
  // kolom userAgent di CSV/meta adalah browser yang benar-benar dipakai
  const cdp = await browser.newBrowserCDPSession();
  const { userAgent: realUserAgent } = (await cdp.send("Browser.getVersion")) as { userAgent: string };
  await cdp.detach();
  const context = await browser.newContext({
    baseURL,
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
    userAgent: realUserAgent,
  });
  const page = await context.newPage();
  const userAgent = await page.evaluate(() => navigator.userAgent);
  fs.writeFileSync(path.join(OUT, "browser.txt"), `browser.version() = ${browser.version()}\nuserAgent = ${userAgent}\n`);
  console.log(`Browser ${browser.version()} (${userAgent})`);

  await importCsv(page, DATA!);
  await openMenu(page.getByTestId("analyze-menu-trigger"), page.getByRole("menuitem", { name: "Regression" }));
  await page.getByRole("menuitem", { name: "Regression" }).click();
  await page.getByRole("menuitem", { name: "Binary Logistic (Experiment)...", exact: true }).click();
  await expect(page.getByTestId("bl-exp-dialog")).toBeVisible();

  await page.getByTestId(`bl-exp-variable-item-${DEPENDENT}`).click();
  await page.getByTestId("bl-exp-move-to-dependent").click();
  for (const v of COVARIATES) {
    await page.getByTestId(`bl-exp-variable-item-${v}`).click();
    await page.getByTestId("bl-exp-move-to-covariates").click();
  }
  await page.getByTestId("bl-exp-tab-experiment").click();
  const nOriginal = await page.getByTestId("bl-exp-n-original").innerText();
  console.log(`Dataset ${path.basename(DATA!)}: ${DEPENDENT} ~ ${COVARIATES.join(" + ")}, N = ${nOriginal}`);

  await page.getByTestId("bl-exp-warmup").fill(WARMUP);
  await page.getByTestId("bl-exp-repetitions").fill(REPETITIONS);
  // Batch v1: resample dengan pengembalian, N naik, satu seed untuk data dan urutan
  await page.getByTestId("bl-exp-sampling-resample").click();
  await page.getByTestId("bl-exp-size-order-ascending").click();
  await page.getByTestId("bl-exp-data-seed").fill(SEED);
  await page.getByTestId("bl-exp-order-seed").fill(SEED);

  for (const { workload, perRun } of BATCHES) {
    await page.getByTestId(`bl-exp-workload-${workload}`).click();
    // Siklus hidup worker batch: persistent atau per-run (v1 tidak punya interleaved)
    const lifecycle = page.getByTestId(`bl-exp-lifecycle-${perRun ? "per-run" : "persistent"}`);
    await lifecycle.click();
    await expect(lifecycle).toBeChecked();
    const started = Date.now();
    await page.getByTestId("bl-exp-run-batch").click();
    const result = page.locator(`[data-testid="bl-exp-batch-result"][data-workload="${workload}"]`);
    await expect(page.getByTestId("bl-exp-run-batch")).toBeDisabled();
    await expect(page.getByTestId("bl-exp-run-batch")).toBeEnabled({ timeout: 80 * 60_000 });
    await expect(result).toHaveAttribute("data-status", "done");
    const suffix = perRun ? "-per-run" : "";
    const csv = await save(page, "bl-exp-download-csv", suffix);
    const meta = await save(page, "bl-exp-download-meta", suffix);
    const label = `${workload}, ${perRun ? "per-run" : "persistent"} workers`;
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(0)} s → ${csv}, ${meta}`);
  }
  await context.close();
});
