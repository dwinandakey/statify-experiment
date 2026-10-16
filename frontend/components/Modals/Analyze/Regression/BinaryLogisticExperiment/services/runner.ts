/**
 * Runner eksperimen 2×2: satu run per mode ("Run once") dan batch benchmark.
 *
 * Aturan pengukuran (lihat EXPERIMENT.md):
 * - Persiapan data (prepareData/resample), pemuatan modul/worker, dan
 *   penyalinan buffer (X.slice(), y.slice()) terjadi SEBELUM timer untuk
 *   semua mode, supaya perlakuannya sama.
 * - computeMs diukur di konteks tempat inti berjalan. e2eMs diukur di main
 *   thread dari tepat sebelum dispatch sampai hasil tersedia di main thread.
 *   Untuk mode main, dispatch = pemanggilan fungsi itu sendiri, sehingga
 *   e2eMs = computeMs dan overheadMs = 0.
 * - Urutan per run: ukur → laporkan progress (setState) → jeda 2 rAF + 50 ms
 *   (React merender di sini, di luar jendela ukur) → ambil long task.
 * - Workload "full" (tombol OK dan batch analisis lengkap): mesin analisis
 *   lengkap per mode, lalu formatter tabel SPSS produksi di main thread, masih
 *   di dalam jendela ukur (formatMs, totalMs). Tabel batch hanya di-hash untuk
 *   validasi lalu dibuang; tidak ada yang ditulis ke output viewer.
 */
import type { BinaryLogisticOutput } from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import type {
  BatchMeta,
  BatchOutcome,
  BatchProgress,
  BatchSettings,
  CoreResult,
  DatasetForRun,
  ExperimentMode,
  FullAnalysisInput,
  FullRunRecord,
  InitTimings,
  PreparedData,
  RunRecord,
  WarmWorkerInit,
} from "../types/experiment";
import { DEFAULT_MAX_ITER, DEFAULT_TOL, MODES, MODE_ORDER } from "../types/experiment";
import {
  FrameMonitor,
  type FrameStats,
  LongTaskCollector,
  bytesToMB,
  captureEnvironment,
  heapUsedMB,
  interRunPause,
  nextTask,
} from "./metrics";
import { resample, resampleFull } from "./prepareData";
import { deriveSeed, mulberry32, shuffleInPlace } from "./prng";
import { coefficientsFromResult, formatSpssTables, spssTablesHash } from "./spssFormat";

// Modul di /public, dimuat browser apa adanya (tanpa webpack/SWC). Specifier
// disimpan di konstanta: literal path absolut di import() memicu TS2307 karena
// TypeScript mencoba me-resolve-nya sebagai file; hasil runtime-nya identik.
export const IRLS_CORE_URL = "/workers/Regression/BinaryExperiment/irls_core.js";
export const ENTER_JS_URL = "/workers/Regression/BinaryExperiment/logistic_enter.js";
export const WASM_PKG_URL = "/workers/Regression/BinaryExperiment/pkg/statify_logistic.js";
export const JS_WORKER_URL = "/workers/Regression/BinaryExperiment/jsCore.worker.js";
export const WASM_WORKER_URL = "/workers/Regression/BinaryExperiment/wasmCore.worker.js";

const WORKER_SPAWN_TIMEOUT_MS = 60_000;
const WORKER_RUN_TIMEOUT_MS = 10 * 60_000;

interface RawCoreResult {
  beta: ArrayLike<number>;
  se: ArrayLike<number>;
  neg2ll: number;
  iterations: number;
  converged: boolean;
  stepHalvings: number;
  coreMs?: number;
}

interface IrlsCoreModule {
  irlsCore(X: Float64Array, y: Float64Array, n: number, p: number, maxIter?: number, tol?: number): RawCoreResult;
}

interface WasmExports {
  memory: WebAssembly.Memory;
}

interface WasmPkgModule {
  default: () => Promise<WasmExports>;
  irls_core_bench(x: Float64Array, n: number, p: number, y: Float64Array, maxIter: number, tol: number): RawCoreResult;
  calculate_binary_logistic(
    x: Float64Array,
    rows: number,
    cols: number,
    y: Float64Array,
    configJson: string,
    featureNamesJson: string
  ): string;
}

interface EnterModule {
  calculateBinaryLogistic(
    x: Float64Array,
    rows: number,
    cols: number,
    y: Float64Array,
    configJson: string,
    featureNamesJson: string
  ): unknown;
}

type WorkerKind = "B" | "D";

export class AbortRunError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "AbortError";
  }
}

class WorkerFailure extends Error {}

const isAbort = (err: unknown) => err instanceof Error && err.name === "AbortError";

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

// --- Modul main thread (mode A dan C): dimuat sekali per page load ---

const mainThreadInit: InitTimings = { jsImportMs: null, enterImportMs: null, wasmImportMs: null, wasmInitMs: null };
let jsCorePromise: Promise<IrlsCoreModule> | null = null;
let enterPromise: Promise<EnterModule> | null = null;
let wasmPromise: Promise<{ pkg: WasmPkgModule; exports: WasmExports }> | null = null;

/** Durasi import/init pertama di halaman ini (cold, sekali per page load). */
export function getMainThreadInit(): InitTimings {
  return { ...mainThreadInit };
}

export function loadJsCore(): Promise<IrlsCoreModule> {
  if (!jsCorePromise) {
    jsCorePromise = (async () => {
      const t0 = performance.now();
      const mod = (await import(/* webpackIgnore: true */ IRLS_CORE_URL)) as IrlsCoreModule;
      mainThreadInit.jsImportMs = performance.now() - t0;
      return mod;
    })();
    jsCorePromise.catch(() => {
      jsCorePromise = null;
    });
  }
  return jsCorePromise;
}

/** Mode A (OK): port JS analisis lengkap, dimuat sekali per page load. */
export function loadEnterJs(): Promise<EnterModule> {
  if (!enterPromise) {
    enterPromise = (async () => {
      const t0 = performance.now();
      const mod = (await import(/* webpackIgnore: true */ ENTER_JS_URL)) as EnterModule;
      mainThreadInit.enterImportMs = performance.now() - t0;
      return mod;
    })();
    enterPromise.catch(() => {
      enterPromise = null;
    });
  }
  return enterPromise;
}

export function loadWasmMain(): Promise<{ pkg: WasmPkgModule; exports: WasmExports }> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const t0 = performance.now();
      const pkg = (await import(/* webpackIgnore: true */ WASM_PKG_URL)) as WasmPkgModule;
      const t1 = performance.now();
      const exports = await pkg.default();
      mainThreadInit.wasmImportMs = t1 - t0;
      mainThreadInit.wasmInitMs = performance.now() - t1;
      return { pkg, exports };
    })();
    wasmPromise.catch(() => {
      wasmPromise = null;
    });
  }
  return wasmPromise;
}

// --- Worker (mode B dan D) ---

interface SpawnedWorker {
  worker: Worker;
  /** Pembuatan worker sampai pesan "ready" diterima, dikurangi initMs. */
  spawnMs: number;
  /** Inisialisasi di dalam worker (wasm init untuk D; ≈0 untuk B). */
  initMs: number;
}

export function spawnWorker(kind: WorkerKind): Promise<SpawnedWorker> {
  return new Promise((resolve, reject) => {
    const url = kind === "B" ? JS_WORKER_URL : WASM_WORKER_URL;
    const t0 = performance.now();
    const worker = new Worker(new URL(url, window.location.origin), { type: "module" });
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const fail = (err: Error) => {
      cleanup();
      worker.terminate();
      reject(err);
    };
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m?.type === "ready") {
        const readyMs = performance.now() - t0;
        cleanup();
        resolve({ worker, spawnMs: readyMs - m.initMs, initMs: m.initMs });
      } else if (m?.type === "error") {
        fail(new WorkerFailure(`Worker ${kind} failed to initialize: ${m.message}`));
      }
    };
    const onError = (ev: ErrorEvent) => {
      ev.preventDefault();
      fail(new WorkerFailure(`Worker ${kind} failed to load: ${ev.message || "unknown error"}`));
    };
    const timer = setTimeout(
      () => fail(new WorkerFailure(`Worker ${kind} did not become ready within ${WORKER_SPAWN_TIMEOUT_MS / 1000} s`)),
      WORKER_SPAWN_TIMEOUT_MS
    );
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ type: "init" });
  });
}

/** Worker persisten (warm): dibuat dan di-init sekali, dipakai ulang antar run. */
export class WorkerPool {
  readonly initInfo: Partial<Record<WorkerKind, WarmWorkerInit>> = {};
  private workers: Partial<Record<WorkerKind, Promise<SpawnedWorker>>> = {};

  has(kind: WorkerKind): boolean {
    return this.workers[kind] !== undefined;
  }

  get(kind: WorkerKind): Promise<SpawnedWorker> {
    let p = this.workers[kind];
    if (!p) {
      const created = spawnWorker(kind).then((s) => {
        this.initInfo[kind] = { spawnMs: s.spawnMs, initMs: s.initMs };
        return s;
      });
      created.catch(() => {
        if (this.workers[kind] === created) delete this.workers[kind];
      });
      this.workers[kind] = created;
      p = created;
    }
    return p;
  }

  /** Buang worker (setelah crash/cancel) supaya get() berikutnya membuat yang baru. */
  discard(kind: WorkerKind): void {
    const p = this.workers[kind];
    delete this.workers[kind];
    p?.then(
      (s) => s.worker.terminate(),
      () => undefined
    );
  }

  dispose(): void {
    this.discard("B");
    this.discard("D");
  }
}

let runCounter = 0;

/** Hasil satu dispatch terukur: t0/t1 di jam main thread, computeMs di konteks eksekusi. */
interface Timed<T> {
  t0: number;
  t1: number;
  computeMs: number;
  raw: T;
  wasmMemoryBytes: number | null;
}

/**
 * Kirim satu pesan run ke worker (X dan y sebagai transferable) dan tunggu
 * hasil dengan runId yang sama. t0 dicatat tepat sebelum postMessage, t1 di
 * awal handler pesan hasil.
 */
function runOnWorker<T>(
  worker: Worker,
  message: Record<string, unknown> & { X: Float64Array; y: Float64Array },
  signal?: AbortSignal
): Promise<Timed<T>> {
  return new Promise((resolve, reject) => {
    const runId = ++runCounter;
    let t0 = 0;
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (ev: MessageEvent) => {
      // Hasil tersedia di main thread: catat waktu sebelum apa pun
      const t1 = performance.now();
      const m = ev.data;
      if (!m || m.runId !== runId) return;
      cleanup();
      if (m.type === "result") {
        resolve({ t0, t1, computeMs: m.computeMs, raw: m.result, wasmMemoryBytes: m.wasmMemoryBytes ?? null });
      } else {
        reject(new Error(m.message || "Worker error"));
      }
    };
    const onError = (ev: ErrorEvent) => {
      ev.preventDefault();
      cleanup();
      reject(new WorkerFailure(ev.message || "Worker crashed"));
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortRunError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new WorkerFailure(`Worker run timed out after ${WORKER_RUN_TIMEOUT_MS / 1000} s`));
    }, WORKER_RUN_TIMEOUT_MS);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });

    t0 = performance.now();
    worker.postMessage({ ...message, runId }, [message.X.buffer, message.y.buffer]);
  });
}

/** Siapkan mesin analisis lengkap di worker (memuat logistic_enter.js / wasm init) di luar timer. */
function initFullOnWorker(worker: Worker): Promise<number> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
    };
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m?.type === "ready_full") {
        cleanup();
        resolve(m.initMs);
      } else if (m?.type === "error" && m.runId === null) {
        cleanup();
        reject(new WorkerFailure(`Worker failed to load the analysis engine: ${m.message}`));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new WorkerFailure("Worker did not load the analysis engine in time"));
    }, WORKER_SPAWN_TIMEOUT_MS);
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "init_full" });
  });
}

// --- Satu run ---

// Hitung perubahan visibilitas halaman: tab tersembunyi menghentikan rAF,
// sehingga metrik frame run tersebut tidak valid dan perlu ditandai.
let visibilityChanges = 0;
let visibilityListenerInstalled = false;
function ensureVisibilityListener(): void {
  if (visibilityListenerInstalled || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    visibilityChanges++;
  });
  visibilityListenerInstalled = true;
}

export interface RunEnv {
  monitor: FrameMonitor;
  longTasks: LongTaskCollector;
  pool: WorkerPool;
  coldWorkers: boolean;
  maxIter: number;
  tol: number;
  signal?: AbortSignal;
}

interface PendingRun {
  mode: ExperimentMode;
  timestamp: string;
  spawnMs: number | null;
  initMs: number | null;
  t0: number;
  t1: number;
  computeMs: number;
  raw: RawCoreResult | null;
  error: string | null;
  frames: FrameStats;
  windowEnd: number;
  heapUsedMB: number | null;
  wasmMemoryBytes: number | null;
  pageHidden: boolean;
}

interface Measured<T> {
  t0: number;
  t1: number;
  computeMs: number;
  raw: T | null;
  error: string | null;
  frames: FrameStats;
  windowEnd: number;
  heapUsedMB: number | null;
  wasmMemoryBytes: number | null;
  pageHidden: boolean;
}

/**
 * Jendela pengukuran bersama untuk run inti (Run once/batch) dan analisis
 * lengkap (OK): monitor frame menunggu frame baseline, dispatch dari task baru
 * (bukan dari callback rAF), lalu menunggu satu frame setelah hasil tersedia.
 * Untuk mode main, `dispatch` mengerjakan t0 → panggilan → t1 secara sinkron.
 * Worker yang crash/dibatalkan dibuang dari pool; worker cold diakhiri; abort
 * dilempar ulang setelah monitor dihentikan.
 */
async function measureWindow<T>(
  mode: ExperimentMode,
  env: RunEnv,
  spawned: SpawnedWorker | null,
  dispatch: () => Promise<Timed<T>>
): Promise<Measured<T>> {
  ensureVisibilityListener();
  const visibilityAtStart = visibilityChanges;
  const hiddenAtStart = document.hidden;

  await env.monitor.start();
  await nextTask();
  let t0 = performance.now();
  let t1 = t0;
  let computeMs = NaN;
  let raw: T | null = null;
  let error: string | null = null;
  let wasmMemoryBytes: number | null = null;
  let abort: unknown = null;
  try {
    const out = await dispatch();
    ({ t0, t1, computeMs, raw, wasmMemoryBytes } = out);
  } catch (err) {
    t1 = performance.now();
    error = errorMessage(err);
    if (isAbort(err)) abort = err;
    // Worker yang crash/dibatalkan tidak bisa dipercaya lagi
    if ((isAbort(err) || err instanceof WorkerFailure) && (mode === "B" || mode === "D") && !env.coldWorkers) {
      env.pool.discard(mode);
    }
  }

  // Tunggu satu frame lagi agar gap yang memuat blocking ikut tercatat
  const frames = await env.monitor.stop();
  const windowEnd = performance.now();
  const heap = heapUsedMB();
  if (env.coldWorkers && spawned) spawned.worker.terminate();
  if (abort) throw abort;

  return {
    t0,
    t1,
    computeMs,
    raw,
    error,
    frames,
    windowEnd,
    heapUsedMB: heap,
    wasmMemoryBytes,
    pageHidden: hiddenAtStart || document.hidden || visibilityChanges !== visibilityAtStart,
  };
}

/** Panggilan sinkron terukur di main thread (t0 → fn → t1 tanpa await di antaranya). */
function timedCall<T>(fn: () => T, wasmMemory?: () => number): Timed<T> {
  const t0 = performance.now();
  const raw = fn();
  const t1 = performance.now();
  return { t0, t1, computeMs: t1 - t0, raw, wasmMemoryBytes: wasmMemory ? wasmMemory() : null };
}

async function measureRun(mode: ExperimentMode, data: DatasetForRun, env: RunEnv): Promise<PendingRun> {
  const timestamp = new Date().toISOString();
  const { maxIter, tol } = env;
  let spawnMs: number | null = null;
  let initMs: number | null = null;

  // 1. Persiapan di luar timer: modul main thread atau worker
  let jsCore: IrlsCoreModule | null = null;
  let wasmMain: { pkg: WasmPkgModule; exports: WasmExports } | null = null;
  let spawned: SpawnedWorker | null = null;
  if (mode === "A") jsCore = await loadJsCore();
  else if (mode === "C") wasmMain = await loadWasmMain();
  else if (env.coldWorkers) {
    spawned = await spawnWorker(mode);
    spawnMs = spawned.spawnMs;
    initMs = spawned.initMs;
  } else {
    spawned = await env.pool.get(mode);
  }

  // 2. Salinan buffer (transferable untuk worker) juga sebelum timer, untuk semua mode
  const X = data.X.slice();
  const y = data.y.slice();

  // 3. Dispatch terukur
  const m = await measureWindow<RawCoreResult>(mode, env, spawned, async () => {
    if (mode === "A") return timedCall(() => jsCore!.irlsCore(X, y, data.n, data.p, maxIter, tol));
    if (mode === "C") {
      return timedCall(
        () => wasmMain!.pkg.irls_core_bench(X, data.n, data.p, y, maxIter, tol),
        () => wasmMain!.exports.memory.buffer.byteLength
      );
    }
    return runOnWorker<RawCoreResult>(
      spawned!.worker,
      { type: "run", X, y, n: data.n, p: data.p, maxIter, tol },
      env.signal
    );
  });

  return { mode, timestamp, spawnMs, initMs, ...m };
}

/** Keluaran pipeline analisis lengkap: hasil mesin + tabel SPSS terformat. */
interface FullOutput {
  result: unknown;
  formatted: BinaryLogisticOutput;
  formatMs: number;
  /** Tabel SPSS selesai diformat (jam main thread). */
  tDone: number;
}

type SpssFormatter = (raw: unknown) => BinaryLogisticOutput;

interface PendingFullRun extends Measured<FullOutput> {
  mode: ExperimentMode;
  timestamp: string;
  spawnMs: number | null;
  initMs: number | null;
  workerCreated: boolean;
  engineInitMs: number | null;
}

/** Formatter tabel SPSS produksi untuk input analisis lengkap tertentu (model_info per N). */
function spssFormatter(prepared: PreparedData, input: FullAnalysisInput): SpssFormatter {
  return (raw) => formatSpssTables(raw, input.modelInfo, prepared.dependent, prepared.covariates);
}

/**
 * Satu analisis Binary Logistic lengkap (tombol OK, batch workload "full").
 * A/B: port JS logistic_enter.js; C/D: calculate_binary_logistic Rust dari
 * paket wasm eksperimen (+ JSON.parse hasil, di dalam computeMs). Setelah
 * hasil tersedia di main thread, tabel SPSS diformat dengan formatter produksi
 * (seperti handleAnalyze produksi), masih di dalam jendela ukur. Aturan lain
 * sama dengan run inti: mesin dimuat dan buffer disalin sebelum timer.
 */
async function measureFullRun(
  mode: ExperimentMode,
  input: FullAnalysisInput,
  format: SpssFormatter,
  env: RunEnv
): Promise<PendingFullRun> {
  const timestamp = new Date().toISOString();
  let spawnMs: number | null = null;
  let initMs: number | null = null;
  let workerCreated = false;
  let engineInitMs: number | null = null;

  let enter: EnterModule | null = null;
  let wasmMain: { pkg: WasmPkgModule; exports: WasmExports } | null = null;
  let spawned: SpawnedWorker | null = null;
  const tLoad = performance.now();
  if (mode === "A") {
    enter = await loadEnterJs();
    engineInitMs = performance.now() - tLoad;
  } else if (mode === "C") {
    wasmMain = await loadWasmMain();
    engineInitMs = performance.now() - tLoad;
  } else {
    if (env.coldWorkers) {
      spawned = await spawnWorker(mode);
      workerCreated = true;
      spawnMs = spawned.spawnMs;
      initMs = spawned.initMs;
    } else {
      const existed = env.pool.has(mode);
      spawned = await env.pool.get(mode);
      if (!existed) {
        workerCreated = true;
        spawnMs = spawned.spawnMs;
        initMs = spawned.initMs;
      }
    }
    try {
      engineInitMs = await initFullOnWorker(spawned.worker);
    } catch (err) {
      if (env.coldWorkers) spawned.worker.terminate();
      else env.pool.discard(mode);
      throw err;
    }
  }

  const X = input.X.slice();
  const y = input.y.slice();
  const { rows, cols, configJson, featureNamesJson } = input;

  const m = await measureWindow<FullOutput>(mode, env, spawned, async () => {
    let timed: Timed<unknown>;
    if (mode === "A") {
      timed = timedCall(() => enter!.calculateBinaryLogistic(X, rows, cols, y, configJson, featureNamesJson));
    } else if (mode === "C") {
      timed = timedCall(
        () => JSON.parse(wasmMain!.pkg.calculate_binary_logistic(X, rows, cols, y, configJson, featureNamesJson)) as unknown,
        () => wasmMain!.exports.memory.buffer.byteLength
      );
    } else {
      timed = await runOnWorker<unknown>(
        spawned!.worker,
        { type: "run_full", X, y, rows, cols, configJson, featureNamesJson },
        env.signal
      );
    }
    // Tabel SPSS di main thread untuk keempat mode, seperti dialog produksi
    const f0 = performance.now();
    const formatted = format(timed.raw);
    const tDone = performance.now();
    return { ...timed, raw: { result: timed.raw, formatted, formatMs: tDone - f0, tDone } };
  });

  return { mode, timestamp, spawnMs, initMs, workerCreated, engineInitMs, ...m };
}

function normalizeResult(raw: RawCoreResult, mode: ExperimentMode): CoreResult {
  return {
    beta: Array.from(raw.beta),
    se: Array.from(raw.se),
    neg2ll: raw.neg2ll,
    iterations: raw.iterations,
    converged: raw.converged,
    stepHalvings: raw.stepHalvings,
    wasmCoreMs: MODES[mode].technology === "wasm" && typeof raw.coreMs === "number" ? raw.coreMs : null,
  };
}

interface RecordContext {
  batchId: string;
  runIndex: number;
  phase: RunRecord["phase"];
  N: number;
  p: number;
  rep: number;
  orderInRep: number;
  coldWorkers: boolean;
}

function finalizeRun(pending: PendingRun, ctx: RecordContext, longTasks: LongTaskCollector): RunRecord {
  const lt = longTasks.collect(pending.t0, pending.windowEnd);
  const e2eMs = pending.t1 - pending.t0;
  const isWorker = MODES[pending.mode].location === "worker";
  return {
    batchId: ctx.batchId,
    workload: "core",
    runIndex: ctx.runIndex,
    phase: ctx.phase,
    N: ctx.N,
    p: ctx.p,
    rep: ctx.rep,
    orderInRep: ctx.orderInRep,
    mode: pending.mode,
    workerStart: isWorker ? (ctx.coldWorkers ? "cold" : "warm") : null,
    computeMs: pending.computeMs,
    e2eMs,
    overheadMs: e2eMs - pending.computeMs,
    spawnMs: pending.spawnMs,
    initMs: pending.initMs,
    engineInitMs: null,
    formatMs: null,
    totalMs: null,
    tablesHash: null,
    maxFrameGapMs: pending.frames.maxFrameGapMs,
    droppedFrames: pending.frames.droppedFrames,
    frameCount: pending.frames.frameCount,
    longTaskCount: lt ? lt.count : null,
    longTaskTotalMs: lt ? lt.totalMs : null,
    heapUsedMB: pending.heapUsedMB,
    wasmMemoryMB: bytesToMB(pending.wasmMemoryBytes),
    pageHidden: pending.pageHidden,
    result: pending.raw && !pending.error ? normalizeResult(pending.raw, pending.mode) : null,
    error: pending.error,
    timestamp: pending.timestamp,
  };
}

/** Rekaman batch workload "full": B/S.E. dari tabel Variables in the Equation, tabel SPSS sebagai hash. */
function finalizeFullRun(
  pending: PendingFullRun,
  ctx: RecordContext,
  longTasks: LongTaskCollector,
  featureNames: string[],
  tablesHash: string | null
): RunRecord {
  const lt = longTasks.collect(pending.t0, pending.windowEnd);
  const e2eMs = pending.t1 - pending.t0;
  const out = pending.error ? null : pending.raw;
  return {
    batchId: ctx.batchId,
    workload: "full",
    runIndex: ctx.runIndex,
    phase: ctx.phase,
    N: ctx.N,
    p: ctx.p,
    rep: ctx.rep,
    orderInRep: ctx.orderInRep,
    mode: pending.mode,
    workerStart: MODES[pending.mode].location === "worker" ? (ctx.coldWorkers ? "cold" : "warm") : null,
    computeMs: pending.computeMs,
    e2eMs,
    overheadMs: e2eMs - pending.computeMs,
    spawnMs: pending.spawnMs,
    initMs: pending.initMs,
    engineInitMs: pending.engineInitMs,
    formatMs: out ? out.formatMs : null,
    totalMs: out ? out.tDone - pending.t0 : null,
    tablesHash: out ? tablesHash : null,
    maxFrameGapMs: pending.frames.maxFrameGapMs,
    droppedFrames: pending.frames.droppedFrames,
    frameCount: pending.frames.frameCount,
    longTaskCount: lt ? lt.count : null,
    longTaskTotalMs: lt ? lt.totalMs : null,
    heapUsedMB: pending.heapUsedMB,
    wasmMemoryMB: bytesToMB(pending.wasmMemoryBytes),
    pageHidden: pending.pageHidden,
    result: out ? coefficientsFromResult(out.result, featureNames) : null,
    error: pending.error,
    timestamp: pending.timestamp,
  };
}

// --- Sesi: dimiliki dialog, menyimpan monitor/observer/worker antar run ---

export interface BatchCallbacks {
  onProgress: (progress: BatchProgress) => void;
}

export function totalBatchRuns(settings: Pick<BatchSettings, "sizes" | "warmup" | "repetitions">): number {
  return settings.sizes.length * (settings.warmup + settings.repetitions) * MODE_ORDER.length;
}

export class ExperimentSession {
  private readonly monitor = new FrameMonitor();
  private readonly longTasks = new LongTaskCollector();
  private pool = new WorkerPool();
  private busy = false;

  get longTaskSupported(): boolean {
    return this.longTasks.supported;
  }

  get warmWorkerInit(): Partial<Record<WorkerKind, WarmWorkerInit>> {
    return { ...this.pool.initInfo };
  }

  /** Muat modul main thread lebih awal; timing tetap tercatat sekali per page load. */
  async preload(workload: BatchSettings["workload"] = "core"): Promise<void> {
    await Promise.all([workload === "full" ? loadEnterJs() : loadJsCore(), loadWasmMain()]);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async runSingle(
    mode: ExperimentMode,
    data: DatasetForRun,
    opts: { coldWorkers: boolean; maxIter: number; tol: number }
  ): Promise<RunRecord> {
    this.assertIdle();
    this.busy = true;
    try {
      this.longTasks.start();
      const env = this.env(opts.coldWorkers, opts.maxIter, opts.tol);
      const pending = await measureRun(mode, data, env);
      await interRunPause();
      return finalizeRun(
        pending,
        {
          batchId: `single-${Date.now().toString(36)}`,
          runIndex: 1,
          phase: "single",
          N: data.n,
          p: data.p,
          rep: 0,
          orderInRep: 1,
          coldWorkers: opts.coldWorkers,
        },
        this.longTasks
      );
    } finally {
      this.busy = false;
    }
  }

  /** Analisis Binary Logistic lengkap + tabel SPSS pada satu konfigurasi (tombol OK). */
  async runFull(
    mode: ExperimentMode,
    prepared: PreparedData,
    opts: { coldWorkers: boolean }
  ): Promise<FullRunRecord> {
    this.assertIdle();
    this.busy = true;
    try {
      this.longTasks.start();
      const env = this.env(opts.coldWorkers, DEFAULT_MAX_ITER, DEFAULT_TOL);
      const input = prepared.full;
      const pending = await measureFullRun(mode, input, spssFormatter(prepared, input), env);
      await interRunPause();
      const lt = this.longTasks.collect(pending.t0, pending.windowEnd);
      const e2eMs = pending.t1 - pending.t0;
      const out = pending.error ? null : pending.raw;
      return {
        mode,
        timestamp: pending.timestamp,
        rows: input.rows,
        cols: input.cols,
        workerStart: MODES[mode].location === "worker" ? (opts.coldWorkers ? "cold" : "warm") : null,
        workerCreated: pending.workerCreated,
        engineInitMs: pending.engineInitMs,
        computeMs: pending.computeMs,
        e2eMs,
        overheadMs: e2eMs - pending.computeMs,
        spawnMs: pending.spawnMs,
        initMs: pending.initMs,
        maxFrameGapMs: pending.frames.maxFrameGapMs,
        droppedFrames: pending.frames.droppedFrames,
        frameCount: pending.frames.frameCount,
        longTaskCount: lt ? lt.count : null,
        longTaskTotalMs: lt ? lt.totalMs : null,
        heapUsedMB: pending.heapUsedMB,
        wasmMemoryMB: bytesToMB(pending.wasmMemoryBytes),
        pageHidden: pending.pageHidden,
        formatMs: out ? out.formatMs : null,
        totalMs: out ? out.tDone - pending.t0 : null,
        result: out ? out.result : null,
        formatted: out ? out.formatted : null,
        error: pending.error,
      };
    } finally {
      this.busy = false;
    }
  }

  async runBatch(
    prepared: PreparedData,
    settings: BatchSettings,
    callbacks: BatchCallbacks,
    signal: AbortSignal
  ): Promise<BatchOutcome> {
    this.assertIdle();
    validateSettings(settings);
    this.busy = true;

    const full = settings.workload === "full";
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const batchId = full ? `batch-full-${stamp}` : `batch-${stamp}`;
    const total = totalBatchRuns(settings);
    const records: RunRecord[] = [];
    const report = (phase: BatchProgress["phase"], N: number | null, completed: number, message: string) =>
      callbacks.onProgress({ phase, N, completed, total, message });

    let errorMessageText: string | null = null;
    report("preparing", null, 0, "Capturing environment and loading modules…");
    const environment = await captureEnvironment();
    const meta: BatchMeta = {
      batchId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: "preparing",
      settings: { ...settings, sizes: [...settings.sizes] },
      environment,
      mainThreadInit: getMainThreadInit(),
      warmWorkerInit: {},
      dataset: {
        dependent: prepared.dependent.name,
        covariates: prepared.covariates.map((c) => c.name),
        nOriginal: prepared.n,
        nTotalRows: prepared.nTotal,
        nMissing: prepared.nMissing,
        p: prepared.p,
        cols: prepared.full.cols,
      },
      orders: [],
    };

    try {
      // Modul main thread (cold sekali per page load) dan worker warm (sekali per batch)
      await this.preload(settings.workload);
      meta.mainThreadInit = getMainThreadInit();
      this.pool.dispose();
      this.pool = new WorkerPool();
      if (!settings.coldWorkers) {
        const workerB = await this.pool.get("B");
        const workerD = await this.pool.get("D");
        meta.warmWorkerInit = { ...this.pool.initInfo };
        if (full) {
          // Mesin analisis lengkap dimuat sekali di worker warm, sebelum pengukuran
          meta.warmWorkerInit.B = { ...meta.warmWorkerInit.B!, engineInitMs: await initFullOnWorker(workerB.worker) };
          meta.warmWorkerInit.D = { ...meta.warmWorkerInit.D!, engineInitMs: await initFullOnWorker(workerD.worker) };
        }
      }
      this.longTasks.start();
      const env = this.env(settings.coldWorkers, settings.maxIter, settings.tol, signal);

      let completed = 0;
      let runIndex = 0;
      for (const N of settings.sizes) {
        if (signal.aborted) throw new AbortRunError();
        report("preparing", N, completed, `Preparing dataset N = ${N.toLocaleString()}…`);
        const data = full ? null : resample(prepared.X, prepared.y, prepared.n, prepared.p, N, settings.seed);
        const fullInput = full ? resampleFull(prepared.full, N, settings.seed) : null;
        const format = fullInput ? spssFormatter(prepared, fullInput) : null;
        // Stream acak urutan mode per N, terpisah dari stream resampling
        const orderRng = mulberry32(deriveSeed(settings.seed, N));

        for (let rep = 1 - settings.warmup; rep <= settings.repetitions; rep++) {
          const isWarmup = rep <= 0;
          const order = shuffleInPlace([...MODE_ORDER], orderRng);
          if (!isWarmup) meta.orders.push({ N, rep, order: [...order] });

          for (let k = 0; k < order.length; k++) {
            if (signal.aborted) throw new AbortRunError();
            const mode = order[k];
            const label = isWarmup
              ? `Warm-up ${rep + settings.warmup}/${settings.warmup}`
              : `Rep ${rep}/${settings.repetitions}`;
            const progressText = `N = ${N.toLocaleString()} · ${label} · ${MODES[mode].short}`;
            const ctx = (): RecordContext => ({
              batchId,
              runIndex: isWarmup ? 0 : ++runIndex,
              phase: "measure",
              N,
              p: prepared.p,
              rep,
              orderInRep: k + 1,
              coldWorkers: settings.coldWorkers,
            });
            let rec: RunRecord;
            if (fullInput && format) {
              const pending = await measureFullRun(mode, fullInput, format, env);
              // Tabel SPSS hanya di-hash (di luar jendela ukur) lalu dibuang
              const tablesHash = pending.raw && !pending.error ? spssTablesHash(pending.raw.formatted) : null;
              completed++;
              report(isWarmup ? "warmup" : "measure", N, completed, progressText);
              await interRunPause();
              rec = finalizeFullRun(pending, ctx(), this.longTasks, prepared.featureNames, tablesHash);
            } else {
              const pending = await measureRun(mode, data!, env);
              completed++;
              report(isWarmup ? "warmup" : "measure", N, completed, progressText);
              await interRunPause();
              rec = finalizeRun(pending, ctx(), this.longTasks);
            }
            if (!isWarmup) records.push(rec);
          }
        }
      }
      meta.status = "done";
    } catch (err) {
      if (isAbort(err)) {
        meta.status = "cancelled";
      } else {
        meta.status = "error";
        errorMessageText = errorMessage(err);
      }
    } finally {
      meta.finishedAt = new Date().toISOString();
      // Worker warm dibuang setelah batch (Run once membuat ulang bila perlu)
      this.pool.dispose();
      this.pool = new WorkerPool();
      this.busy = false;
    }

    report(meta.status, null, records.length, errorMessageText ?? `Batch ${meta.status}.`);
    return { records, meta, errorMessage: errorMessageText };
  }

  dispose(): void {
    this.monitor.cancel();
    this.longTasks.stop();
    this.pool.dispose();
  }

  private env(coldWorkers: boolean, maxIter: number, tol: number, signal?: AbortSignal): RunEnv {
    return { monitor: this.monitor, longTasks: this.longTasks, pool: this.pool, coldWorkers, maxIter, tol, signal };
  }

  private assertIdle(): void {
    if (this.busy) throw new Error("Another run is still in progress.");
  }
}

export function validateSettings(s: BatchSettings): void {
  if (s.sizes.length === 0) throw new Error("Select at least one data size N.");
  if (s.sizes.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("Every data size N must be a positive integer.");
  if (!Number.isInteger(s.warmup) || s.warmup < 0) throw new Error("Warm-up runs must be a non-negative integer.");
  if (!Number.isInteger(s.repetitions) || s.repetitions < 1) throw new Error("Repetitions must be a positive integer.");
  if (!Number.isInteger(s.seed)) throw new Error("Seed must be an integer.");
  if (!Number.isInteger(s.maxIter) || s.maxIter < 1) throw new Error("Max iterations must be a positive integer.");
  if (!(s.tol > 0)) throw new Error("Convergence tolerance must be positive.");
}
