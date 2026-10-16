/**
 * Worker eksperimen mode D (Rust-Wasm – Web Worker).
 *
 * Memakai paket wasm yang SAMA dengan mode C (main thread):
 * ./pkg/statify_logistic.js (wasm-pack --target web). init() dipanggil sekali
 * per worker; promise-nya di-cache.
 *
 * Protokol sama dengan jsCore.worker.js:
 *   { type: "init" }  →  { type: "ready", initMs, wasmMemoryBytes }
 *   { type: "run", runId, X, y, n, p, maxIter, tol }
 *     →  { type: "result", runId, result, computeMs, wasmMemoryBytes }
 *     →  { type: "error", runId, message }
 *
 * computeMs mengapit pemanggilan irls_core_bench, jadi termasuk penyalinan
 * X dan y ke memori linear Wasm dan serialisasi hasil (serde_wasm_bindgen).
 * result.coreMs adalah durasi inti murni yang diukur di dalam Wasm.
 *
 * Analisis lengkap (tombol OK): calculate_binary_logistic produksi dari paket
 * yang sama; computeMs mencakup JSON.parse hasilnya (string JSON dari Rust).
 *   { type: "init_full" } → { type: "ready_full", initMs }
 *   { type: "run_full", runId, X, y, rows, cols, configJson, featureNamesJson }
 *     → { type: "result", runId, result, computeMs, wasmMemoryBytes }
 */
import init, { irls_core_bench, calculate_binary_logistic } from "./pkg/statify_logistic.js";

let initPromise = null;
let wasm = null;

function ensureInit() {
  if (!initPromise) {
    initPromise = init().then((exports) => {
      wasm = exports;
      return exports;
    });
  }
  return initPromise;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "init") {
    try {
      const t0 = performance.now();
      await ensureInit();
      const initMs = performance.now() - t0;
      self.postMessage({ type: "ready", initMs, wasmMemoryBytes: wasmMemoryBytes() });
    } catch (err) {
      self.postMessage({ type: "error", runId: null, message: errorMessage(err) });
    }
    return;
  }

  if (msg.type === "init_full") {
    try {
      const t0 = performance.now();
      await ensureInit();
      self.postMessage({ type: "ready_full", initMs: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: "error", runId: null, message: errorMessage(err) });
    }
    return;
  }

  if (msg.type === "run_full") {
    const { runId, X, y, rows, cols, configJson, featureNamesJson } = msg;
    try {
      await ensureInit();
      const t0 = performance.now();
      const result = JSON.parse(calculate_binary_logistic(X, rows, cols, y, configJson, featureNamesJson));
      const computeMs = performance.now() - t0;
      self.postMessage({ type: "result", runId, result, computeMs, wasmMemoryBytes: wasmMemoryBytes() });
    } catch (err) {
      self.postMessage({ type: "error", runId, message: errorMessage(err) });
    }
    return;
  }

  if (msg.type === "run") {
    const { runId, X, y, n, p, maxIter, tol } = msg;
    try {
      await ensureInit(); // no-op bila sudah di-init lewat pesan "init"
      const t0 = performance.now();
      const result = irls_core_bench(X, n, p, y, maxIter, tol);
      const computeMs = performance.now() - t0;
      self.postMessage({
        type: "result",
        runId,
        result,
        computeMs,
        wasmMemoryBytes: wasmMemoryBytes(),
      });
    } catch (err) {
      self.postMessage({ type: "error", runId, message: errorMessage(err) });
    }
  }
};

function wasmMemoryBytes() {
  return wasm && wasm.memory ? wasm.memory.buffer.byteLength : null;
}

// Error dari Rust dilempar sebagai string (JsValue::from_str), bukan Error.
function errorMessage(err) {
  if (typeof err === "string") return err;
  return (err && err.message) || String(err);
}
