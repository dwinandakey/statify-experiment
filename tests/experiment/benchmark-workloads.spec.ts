import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Runner benchmark (bukan bagian E2E biasa): batch workload "core" lalu "full"
 * dengan pengaturan dan dataset yang SAMA, di sesi browser yang sama, lalu CSV
 * dan meta.json tiap batch disimpan (default: benchmark-results/ di root repo,
 * di luar test-results/ yang dikosongkan Playwright setiap run). Dipakai untuk memisahkan efek runtime
 * (core: IRLS identik di JS dan Rust) dari efek implementasi (full: port JS vs
 * jalur produksi nalgebra). Analisis: scripts/compareWorkloads.mjs.
 *
 * Dilewati kecuali EXPERIMENT_BENCH_DATA diisi. Contoh (PowerShell, dari root repo,
 * setelah production build):
 *   $env:EXPERIMENT_BENCH_DATA = "C:\data\HR-Employee-Attrition.csv"
 *   $env:EXPERIMENT_BENCH_OUT = "C:\data\bench-out"   # opsional
 *   $env:EXPERIMENT_BENCH_CHANNEL = "chrome"   # Chrome terpasang, bukan Chromium Playwright
 *   $env:EXPERIMENT_PORT = "3002"
 *   npx playwright test -c tests/experiment/playwright.experiment.config.ts benchmark-workloads
 *
 * Variabel lain (default = batch HR Attrition): EXPERIMENT_BENCH_DEPENDENT,
 * EXPERIMENT_BENCH_COVARIATES (dipisah koma), EXPERIMENT_BENCH_WORKLOADS
 * ("core,full"), EXPERIMENT_BENCH_WARMUP (5), EXPERIMENT_BENCH_REPETITIONS (30),
 * EXPERIMENT_BENCH_SEED (42). Ukuran N: N asli + 10.000 + 50.000 + 100.000
 * (default dialog), worker warm.
 */
const env = process.env;
const DATA = env.EXPERIMENT_BENCH_DATA;
const OUT = env.EXPERIMENT_BENCH_OUT ?? path.join(__dirname, "../../benchmark-results");
const DEPENDENT = env.EXPERIMENT_BENCH_DEPENDENT ?? "Attrition";
const COVARIATES = (
  env.EXPERIMENT_BENCH_COVARIATES ??
  "Age,BusinessTravel,DistanceFromHome,MaritalStatus,MonthlyIncome,MonthlyRate,OverTime,TotalWorkingYears,YearsAtCompany"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WORKLOADS = (env.EXPERIMENT_BENCH_WORKLOADS ?? "core,full").split(",").map((s) => s.trim()) as ("core" | "full")[];
const WARMUP = env.EXPERIMENT_BENCH_WARMUP ?? "5";
const REPETITIONS = env.EXPERIMENT_BENCH_REPETITIONS ?? "30";
const SEED = env.EXPERIMENT_BENCH_SEED ?? "42";

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

async function save(page: Page, testId: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  const target = path.join(OUT, download.suggestedFilename());
  await download.saveAs(target);
  return target;
}

test("benchmark: core and full workloads with identical settings", async ({ browser, baseURL }) => {
  test.skip(!DATA, "Set EXPERIMENT_BENCH_DATA to run the workload benchmark.");
  test.setTimeout(90 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });
  // Context sendiri tanpa userAgent dari device descriptor proyek, supaya kolom
  // userAgent di CSV/meta adalah browser yang benar-benar dipakai
  const context = await browser.newContext({ baseURL, acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
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
  await page.getByTestId("bl-exp-seed").fill(SEED);

  for (const workload of WORKLOADS) {
    await page.getByTestId(`bl-exp-workload-${workload}`).click();
    const started = Date.now();
    await page.getByTestId("bl-exp-run-batch").click();
    const result = page.locator(`[data-testid="bl-exp-batch-result"][data-workload="${workload}"]`);
    await expect(page.getByTestId("bl-exp-run-batch")).toBeDisabled();
    await expect(page.getByTestId("bl-exp-run-batch")).toBeEnabled({ timeout: 80 * 60_000 });
    await expect(result).toHaveAttribute("data-status", "done");
    const csv = await save(page, "bl-exp-download-csv");
    const meta = await save(page, "bl-exp-download-meta");
    console.log(`${workload}: ${((Date.now() - started) / 1000).toFixed(0)} s → ${csv}, ${meta}`);
  }
  await context.close();
});
