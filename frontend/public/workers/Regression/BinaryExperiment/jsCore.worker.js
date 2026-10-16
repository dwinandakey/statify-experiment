/**
 * Worker eksperimen mode B (JavaScript – Web Worker).
 *
 * Menjalankan irls_core.js yang SAMA dengan mode A (main thread). Dibuat
 * sebagai module worker: new Worker(url, { type: "module" }).
 *
 * Protokol:
 *   main → worker: { type: "init" }
 *   worker → main: { type: "ready", initMs }
 *   main → worker: { type: "run", runId, X, y, n, p, maxIter, tol }  (X, y transferable)
 *   worker → main: { type: "result", runId, result, computeMs }
 *   worker → main: { type: "error", runId, message }
 *
 * Semua durasi diukur dengan performance.now() milik worker ini; yang dikirim
 * hanya durasi, bukan timestamp, karena timeOrigin worker berbeda dari main.
 */
import { irlsCore } from "./irls_core.js";

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "init") {
    // irls_core.js sudah dimuat statis saat worker dibuat (masuk ke spawnMs);
    // tidak ada inisialisasi lain, jadi initMs ≈ 0.
    const t0 = performance.now();
    const initMs = performance.now() - t0;
    self.postMessage({ type: "ready", initMs });
    return;
  }

  if (msg.type === "run") {
    const { runId, X, y, n, p, maxIter, tol } = msg;
    try {
      const t0 = performance.now();
      const result = irlsCore(X, y, n, p, maxIter, tol);
      const computeMs = performance.now() - t0;
      self.postMessage({ type: "result", runId, result, computeMs });
    } catch (err) {
      self.postMessage({ type: "error", runId, message: errorMessage(err) });
    }
  }
};

function errorMessage(err) {
  if (typeof err === "string") return err;
  return (err && err.message) || String(err);
}
