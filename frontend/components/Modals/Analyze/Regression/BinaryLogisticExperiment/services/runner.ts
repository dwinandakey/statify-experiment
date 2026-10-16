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
 */
import type {
  BatchMeta,
  BatchProgress,
  BatchSettings,
  CoreResult,
  DatasetForRun,
  ExperimentMode,
  InitTimings,
  PreparedData,
  RunRecord,
  WarmWorkerInit,
} from "../types/experiment";
import { MODES, MODE_ORDER } from "../types/experiment";
import {
  FrameMonitor,
  type FrameStats,
  LongTaskCollector,
  bytesToMB,
  captureEnvironment,
  heapUsedMB,
  interRunPause,
} from "./metrics";
import { resample } from "./prepareData";
import { deriveSeed, mulberry32, shuffleInPlace } from "./prng";

// Modul di /public, dimuat browser apa adanya (tanpa webpack/SWC). Specifier
// disimpan di konstanta: literal path absolut di import() memicu TS2307 karena
// TypeScript mencoba me-resolve-nya sebagai file; hasil runtime-nya identik.
export const IRLS_CORE_URL = "/workers/Regression/BinaryExperiment/irls_core.js";
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

const mainThreadInit: InitTimings = { jsImportMs: null, wasmImportMs: null, wasmInitMs: null };
let jsCorePromise: Promise<IrlsCoreModule> | null = null;
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

interface WorkerRunOutcome {
  t0: number;
  t1: number;
  computeMs: number;
  raw: RawCoreResult;
  wasmMemoryBytes: number | null;
}

function runOnWorker(
  worker: Worker,
  X: Float64Array,
  y: Float64Array,
  n: number,
  p: number,
  maxIter: number,
  tol: number,
  signal?: AbortSignal
): Promise<WorkerRunOutcome> {
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
    worker.postMessage({ type: "run", runId, X, y, n, p, maxIter, tol }, [X.buffer, y.buffer]);
  });
}

// --- Satu run ---

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

  // 3. Mulai monitor frame; dispatch tepat setelah frame baseline
  await env.monitor.start();
  let t0 = performance.now();
  let t1 = t0;
  let computeMs = NaN;
  let raw: RawCoreResult | null = null;
  let error: string | null = null;
  let wasmMemoryBytes: number | null = null;
  let abort: unknown = null;
  try {
    if (mode === "A") {
      t0 = performance.now();
      raw = jsCore!.irlsCore(X, y, data.n, data.p, maxIter, tol);
      t1 = performance.now();
      computeMs = t1 - t0;
    } else if (mode === "C") {
      t0 = performance.now();
      raw = wasmMain!.pkg.irls_core_bench(X, data.n, data.p, y, maxIter, tol);
      t1 = performance.now();
      computeMs = t1 - t0;
      wasmMemoryBytes = wasmMain!.exports.memory.buffer.byteLength;
    } else {
      const out = await runOnWorker(spawned!.worker, X, y, data.n, data.p, maxIter, tol, env.signal);
      t0 = out.t0;
      t1 = out.t1;
      computeMs = out.computeMs;
      raw = out.raw;
      wasmMemoryBytes = out.wasmMemoryBytes;
    }
  } catch (err) {
    t1 = performance.now();
    error = errorMessage(err);
    if (isAbort(err)) abort = err;
    // Worker yang crash/dibatalkan tidak bisa dipercaya lagi
    if ((isAbort(err) || err instanceof WorkerFailure) && (mode === "B" || mode === "D") && !env.coldWorkers) {
      env.pool.discard(mode);
    }
  }

  // 4. Tunggu satu frame lagi agar gap yang memuat blocking ikut tercatat
  const frames = await env.monitor.stop();
  const windowEnd = performance.now();
  const heap = heapUsedMB();
  if (env.coldWorkers && spawned) spawned.worker.terminate();
  if (abort) throw abort;

  return {
    mode,
    timestamp,
    spawnMs,
    initMs,
    t0,
    t1,
    computeMs,
    raw,
    error,
    frames,
    windowEnd,
    heapUsedMB: heap,
    wasmMemoryBytes,
  };
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
    maxFrameGapMs: pending.frames.maxFrameGapMs,
    droppedFrames: pending.frames.droppedFrames,
    frameCount: pending.frames.frameCount,
    longTaskCount: lt ? lt.count : null,
    longTaskTotalMs: lt ? lt.totalMs : null,
    heapUsedMB: pending.heapUsedMB,
    wasmMemoryMB: bytesToMB(pending.wasmMemoryBytes),
    result: pending.raw && !pending.error ? normalizeResult(pending.raw, pending.mode) : null,
    error: pending.error,
    timestamp: pending.timestamp,
  };
}

// --- Sesi: dimiliki dialog, menyimpan monitor/observer/worker antar run ---

export interface BatchCallbacks {
  onProgress: (progress: BatchProgress) => void;
}

export interface BatchOutcome {
  records: RunRecord[];
  meta: BatchMeta;
  errorMessage: string | null;
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

  /** Muat modul main thread lebih awal (opsional); timing tetap tercatat sekali per page load. */
  async preload(): Promise<void> {
    await Promise.all([loadJsCore(), loadWasmMain()]);
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

  async runBatch(
    prepared: PreparedData,
    settings: BatchSettings,
    callbacks: BatchCallbacks,
    signal: AbortSignal
  ): Promise<BatchOutcome> {
    this.assertIdle();
    validateSettings(settings);
    this.busy = true;

    const batchId = `batch-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
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
      },
      orders: [],
    };

    try {
      // Modul main thread (cold sekali per page load) dan worker warm (sekali per batch)
      await this.preload();
      meta.mainThreadInit = getMainThreadInit();
      this.pool.dispose();
      this.pool = new WorkerPool();
      if (!settings.coldWorkers) {
        await this.pool.get("B");
        await this.pool.get("D");
        meta.warmWorkerInit = { ...this.pool.initInfo };
      }
      this.longTasks.start();
      const env = this.env(settings.coldWorkers, settings.maxIter, settings.tol, signal);

      let completed = 0;
      let runIndex = 0;
      for (const N of settings.sizes) {
        if (signal.aborted) throw new AbortRunError();
        report("preparing", N, completed, `Preparing dataset N = ${N.toLocaleString()}…`);
        const data = resample(prepared.X, prepared.y, prepared.n, prepared.p, N, settings.seed);
        // Stream acak urutan mode per N, terpisah dari stream resampling
        const orderRng = mulberry32(deriveSeed(settings.seed, N));

        for (let rep = 1 - settings.warmup; rep <= settings.repetitions; rep++) {
          const isWarmup = rep <= 0;
          const order = shuffleInPlace([...MODE_ORDER], orderRng);
          if (!isWarmup) meta.orders.push({ N, rep, order: [...order] });

          for (let k = 0; k < order.length; k++) {
            if (signal.aborted) throw new AbortRunError();
            const mode = order[k];
            const pending = await measureRun(mode, data, env);
            completed++;
            const label = isWarmup
              ? `Warm-up ${rep + settings.warmup}/${settings.warmup}`
              : `Rep ${rep}/${settings.repetitions}`;
            report(isWarmup ? "warmup" : "measure", N, completed, `N = ${N.toLocaleString()} · ${label} · ${MODES[mode].short}`);
            await interRunPause();
            const rec = finalizeRun(
              pending,
              {
                batchId,
                runIndex: isWarmup ? 0 : ++runIndex,
                phase: "measure",
                N,
                p: data.p,
                rep,
                orderInRep: k + 1,
                coldWorkers: settings.coldWorkers,
              },
              this.longTasks
            );
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
