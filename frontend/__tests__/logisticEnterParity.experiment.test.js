/**
 * Paritas port JavaScript pipeline Enter (public/workers/Regression/BinaryExperiment/
 * logistic_enter.js, dipakai mode A/B saat OK) dengan calculate_binary_logistic Rust
 * (paket wasm eksperimen, mode C/D). Skrip dijalankan di proses Node terpisah karena
 * glue wasm-bindgen adalah ES module dengan import.meta yang tidak bisa dimuat Jest.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("logistic_enter.js menghasilkan objek yang sama dengan calculate_binary_logistic Rust", () => {
  const script = path.join(
    __dirname,
    "../components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/checkEnterParity.mjs"
  );
  let output;
  try {
    output = execFileSync(process.execPath, [script], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(`Parity check failed:\n${err.stdout}\n${err.stderr}`);
  }
  expect(output).not.toMatch(/FAIL/);
  expect((output.match(/^PASS /gm) || []).length).toBeGreaterThanOrEqual(7);
});
