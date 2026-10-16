import type { Variable } from "@/types/Variable";

// --- Konfigurasi faktorial 2×2 ---

export type ExperimentMode = "A" | "B" | "C" | "D";

export interface ModeInfo {
  id: ExperimentMode;
  label: string;
  short: string;
  technology: "js" | "wasm";
  location: "main" | "worker";
}

export const MODES: Record<ExperimentMode, ModeInfo> = {
  A: { id: "A", label: "A. JavaScript – Main thread", short: "JS · main", technology: "js", location: "main" },
  B: { id: "B", label: "B. JavaScript – Web Worker", short: "JS · worker", technology: "js", location: "worker" },
  C: { id: "C", label: "C. Rust-Wasm – Main thread", short: "Wasm · main", technology: "wasm", location: "main" },
  D: { id: "D", label: "D. Rust-Wasm – Web Worker", short: "Wasm · worker", technology: "wasm", location: "worker" },
};

export const MODE_ORDER: ExperimentMode[] = ["A", "B", "C", "D"];

// Acuan validasi akurasi antar mode (konfigurasi produksi Statify)
export const REFERENCE_MODE: ExperimentMode = "D";

// --- Algoritma ---

export const DEFAULT_MAX_ITER = 20;
export const DEFAULT_TOL = 0.001;

/** Hasil inti IRLS yang sudah dinormalkan (Float64Array/Array → number[]). */
export interface CoreResult {
  beta: number[];
  se: number[];
  neg2ll: number;
  iterations: number;
  converged: boolean;
  stepHalvings: number;
  /** Durasi irls_core murni di dalam Wasm (mode C/D), null untuk JS. */
  wasmCoreMs: number | null;
}

// --- Data ---

export interface PreparedData {
  /** Row-major n×p, kolom 0 = intercept (semua 1). Jangan dimutasi. */
  X: Float64Array;
  /** 0/1, panjang n. Jangan dimutasi. */
  y: Float64Array;
  n: number;
  p: number;
  /** ["Constant", ...nama kovariat] sesuai urutan kolom X. */
  featureNames: string[];
  /** Pemetaan nilai asli Y → 0/1, persis model_info.y_encoding produksi. */
  yEncoding: Record<string, number>;
  /** Jumlah baris dataset sebelum listwise deletion. */
  nTotal: number;
  nMissing: number;
  dependent: Variable;
  covariates: Variable[];
}

export interface DatasetForRun {
  X: Float64Array;
  y: Float64Array;
  n: number;
  p: number;
  /** false jika N sama dengan N asli (data asli dipakai apa adanya). */
  resampled: boolean;
}

// --- Metrik per run ---

export type WorkerStart = "warm" | "cold";

export interface RunMetrics {
  /** Waktu inti IRLS, diukur di konteks tempat inti dijalankan. */
  computeMs: number;
  /** Main thread: tepat sebelum dispatch → hasil tersedia di main thread. */
  e2eMs: number;
  /** e2eMs - computeMs (postMessage, structured clone, scheduling). */
  overheadMs: number;
  /** Mode worker cold: pembuatan worker sampai siap (tanpa initMs). */
  spawnMs: number | null;
  /** Mode worker cold: inisialisasi di dalam worker (wasm init untuk D). */
  initMs: number | null;
  maxFrameGapMs: number;
  /** Jumlah gap rAF > 2 × 16,7 ms. */
  droppedFrames: number;
  frameCount: number;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  heapUsedMB: number | null;
  wasmMemoryMB: number | null;
  /** Tab tersembunyi kapan pun selama run (rAF berhenti → metrik frame tidak valid). */
  pageHidden: boolean;
}

export interface RunRecord extends RunMetrics {
  batchId: string;
  /** Nomor urut run dalam batch (1-based, hanya run yang dicatat). */
  runIndex: number;
  phase: "measure" | "single";
  N: number;
  p: number;
  /** Ulangan ke- (1-based); 0 untuk Run once. */
  rep: number;
  /** Posisi mode dalam urutan acak ulangan tersebut (1..4). */
  orderInRep: number;
  mode: ExperimentMode;
  workerStart: WorkerStart | null;
  result: CoreResult | null;
  error: string | null;
  /** Waktu mulai run (ISO). */
  timestamp: string;
}

// --- Batch ---

export interface BatchSettings {
  sizes: number[];
  warmup: number;
  repetitions: number;
  seed: number;
  coldWorkers: boolean;
  maxIter: number;
  tol: number;
}

export interface BatchProgress {
  phase: "preparing" | "warmup" | "measure" | "done" | "cancelled" | "error";
  N: number | null;
  completed: number;
  total: number;
  message: string;
}

// --- Lingkungan ---

export interface InitTimings {
  /** Mode A: import(irls_core.js) pertama di halaman ini. */
  jsImportMs: number | null;
  /** Mode C: import(pkg/statify_logistic.js) pertama di halaman ini. */
  wasmImportMs: number | null;
  /** Mode C: init() wasm pertama di halaman ini (fetch + compile + instantiate). */
  wasmInitMs: number | null;
}

export interface WarmWorkerInit {
  spawnMs: number;
  initMs: number;
}

export interface EnvironmentMeta {
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  crossOriginIsolated: boolean;
  buildMode: string;
  gitCommit: string | null;
  /** Estimasi interval refresh layar (median gap rAF saat idle). */
  refreshIntervalMs: number | null;
  /** Estimasi resolusi performance.now() (selisih positif terkecil). */
  timerResolutionMs: number | null;
  longTaskSupported: boolean;
  memoryApiSupported: boolean;
  capturedAt: string;
}

export interface BatchMeta {
  batchId: string;
  startedAt: string;
  finishedAt: string | null;
  status: BatchProgress["phase"];
  settings: BatchSettings;
  environment: EnvironmentMeta;
  mainThreadInit: InitTimings;
  warmWorkerInit: Partial<Record<"B" | "D", WarmWorkerInit>>;
  dataset: {
    dependent: string;
    covariates: string[];
    nOriginal: number;
    nTotalRows: number;
    nMissing: number;
    p: number;
  };
  /** Urutan mode yang dipakai tiap (N, ulangan); untuk audit pengacakan. */
  orders: { N: number; rep: number; order: ExperimentMode[] }[];
}

// --- Ringkasan ---

export interface SummaryStats {
  count: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
}

export interface ModeSummary {
  N: number;
  mode: ExperimentMode;
  runs: number;
  errors: number;
  computeMs: SummaryStats | null;
  e2eMs: SummaryStats | null;
  maxFrameGapMs: SummaryStats | null;
}

export interface AccuracyRow {
  N: number;
  mode: ExperimentMode;
  /** max |beta(mode) - beta(D)| atas semua run mode tsb pada N ini. */
  maxAbsDiffBeta: number;
  maxAbsDiffSe: number;
  iterations: number | null;
  stepHalvings: number | null;
}

export interface ProductionComparisonRow {
  label: string;
  bProduction: number;
  bExperiment: number;
  seProduction: number;
  seExperiment: number;
  absDiffB: number;
  absDiffSe: number;
}

export interface ProductionComparison {
  mode: ExperimentMode;
  n: number;
  rows: ProductionComparisonRow[];
  maxAbsDiffB: number;
  maxAbsDiffSe: number;
  neg2llProduction: number | null;
  neg2llExperiment: number;
  iterationsProduction: number | null;
  iterationsExperiment: number;
  passed: boolean;
  tolerance: number;
}

// --- Hasil yang disimpan dialog (untuk tampilan dan tombol OK) ---

export interface BatchOutcome {
  records: RunRecord[];
  meta: BatchMeta;
  errorMessage: string | null;
}

export interface SingleRunResult {
  record: RunRecord;
  featureNames: string[];
  resampled: boolean;
  nOriginal: number;
}

export interface BatchResult {
  outcome: BatchOutcome;
  summaries: ModeSummary[];
  accuracy: AccuracyRow[];
  featureNames: string[];
}

export interface ComparisonResult {
  comparisons: ProductionComparison[];
}

export interface ExperimentResults {
  single: SingleRunResult | null;
  batch: BatchResult | null;
  comparison: ComparisonResult | null;
}
