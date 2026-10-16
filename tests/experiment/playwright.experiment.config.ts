import { defineConfig, devices } from "@playwright/test";

/**
 * Konfigurasi Playwright khusus menu "Binary Logistic (Experiment)".
 *
 * Dipisah dari playwright.config.ts di root karena file root saat ini tidak
 * valid secara sintaks (blok duplikat, array `projects` tidak ditutup) dan
 * menjalankan `npm run dev`, padahal eksperimen wajib diuji di production build.
 *
 * Jalankan dari root repo setelah `npm run build --workspace=frontend`:
 *   npx playwright test -c tests/experiment/playwright.experiment.config.ts
 * Server `next start` (port 3001) dipakai ulang bila sudah berjalan.
 */
const PORT = Number(process.env.EXPERIMENT_PORT ?? 3001);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 6 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  outputDir: "../../test-results/experiment",
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: {
    command: "npm run start",
    cwd: "../../frontend",
    port: PORT,
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
