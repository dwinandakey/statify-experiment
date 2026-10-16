import type { Variable } from "@/types/Variable";
import type { BinaryLogisticOutput } from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";

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

/**
 * Beban kerja yang diukur:
 * - "core": inti IRLS (B, S.E., −2LL), identik di JS dan Rust (Run once, batch);
 * - "full": analisis Binary Logistic lengkap + format tabel SPSS, sama dengan
 *   tombol OK (A/B: logistic_enter.js, C/D: calculate_binary_logistic).
 */
export type Workload = "core" | "full";

export const WORKLOAD_LABEL: Record<Workload, string> = {
  core: "IRLS core",
  full: "Full analysis + SPSS tables",
};

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
  /** Jumlah step-halving inti IRLS; null untuk analisis lengkap (tidak dilaporkan). */
  stepHalvings: number | null;
  /** Durasi irls_core murni di dalam Wasm (mode C/D), null untuk JS. */
  wasmCoreMs: number | null;
}

// --- Data ---

/** Dummy coding Indicator (referensi Last) satu kovariat kategorik. */
export interface CategoricalCoding {
  variable: string;
  /** Urutan kategori seperti design matrix produksi; yang terakhir = referensi. */
  categories: { label: string; code: number; frequency: number }[];
  /** Nama kolom dummy, `nama(1)` … `nama(k-1)` (sama dengan label produksi). */
  dummyNames: string[];
}

/**
 * Input analisis lengkap (tombol OK), persis seperti yang dikirim worker
 * produksi ke calculate_binary_logistic: kovariat mentah tahap-1 (kategorik =
 * kode), config JSON, dan nama kovariat. Dipakai keempat mode.
 */
export interface FullAnalysisInput {
  /** Row-major rows × cols, kovariat mentah (kode untuk kategorik), tanpa intercept. */
  X: Float64Array;
  y: Float64Array;
  rows: number;
  cols: number;
  configJson: string;
  featureNamesJson: string;
  /** model_info yang ditambahkan worker produksi setelah komputasi (untuk formatter). */
  modelInfo: {
    y_encoding: Record<string, number>;
    x_encodings: Record<string, Record<string, number>>;
    n_samples: number;
    n_missing: number;
    variables: string[];
    include_constant: boolean;
  };
}

export interface PreparedData {
  /** Row-major n×p, kolom 0 = intercept (semua 1). Jangan dimutasi. */
  X: Float64Array;
  /** 0/1, panjang n. Jangan dimutasi. */
  y: Float64Array;
  n: number;
  p: number;
  /** ["Constant", ...nama kolom] sesuai urutan kolom X (dummy: `nama(j)`). */
  featureNames: string[];
  /** Pemetaan nilai asli Y → 0/1, persis model_info.y_encoding produksi. */
  yEncoding: Record<string, number>;
  /** Jumlah baris dataset sebelum listwise deletion. */
  nTotal: number;
  nMissing: number;
  dependent: Variable;
  covariates: Variable[];
  /** Kovariat kategorik (nominal/ordinal) beserta dummy coding-nya. */
  categoricalCodings: CategoricalCoding[];
  /** Input analisis lengkap Binary Logistic (tombol OK). */
  full: FullAnalysisInput;
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
  /** Perkiraan frame yang terlewat: Σ max(0, round(gap / T) − 1), T = frameIntervalMs. */
  droppedFrames: number;
  /** Jumlah gap rAF > 2T (jumlah gap, bukan jumlah frame). */
  longGapCount: number;
  frameCount: number;
  /** Interval refresh T yang dipakai (terukur saat idle; cadangan 1000/60 ms). */
  frameIntervalMs: number;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  /** Heap JS main thread setelah run (Chromium). Heap worker tidak terukur: jangan dibandingkan antarlokasi. */
  mainHeapUsedMB: number | null;
  wasmMemoryMB: number | null;
  /** Workload "full" mode C/D: serde_json::to_string di dalam Wasm (ms). */
  wasmSerializeMs: number | null;
  /** Tab tersembunyi kapan pun selama run (rAF berhenti → metrik frame tidak valid). */
  pageHidden: boolean;
}

export interface RunRecord extends RunMetrics {
  batchId: string;
  workload: Workload;
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
  /** Workload "full": pemuatan mesin analisis lengkap sebelum timer (≈ 0 bila sudah dimuat). */
  engineInitMs: number | null;
  /** Workload "full": formatter SPSS produksi di main thread, di dalam jendela ukur. */
  formatMs: number | null;
  /** Workload "full": dispatch → tabel SPSS selesai diformat di main thread. */
  totalMs: number | null;
  /** Workload "full": hash isi tabel SPSS (validasi: identik dengan mode D). */
  tablesHash: string | null;
  /** B dan S.E. (analisis lengkap: dari tabel Variables in the Equation). */
  result: CoreResult | null;
  error: string | null;
  /** Waktu mulai run (ISO). */
  timestamp: string;
}

/**
 * Satu analisis Binary Logistic lengkap (tombol OK) pada konfigurasi terpilih.
 * A/B: port JS logistic_enter.js; C/D: calculate_binary_logistic Rust-Wasm.
 */
export interface FullRunRecord extends RunMetrics {
  mode: ExperimentMode;
  timestamp: string;
  rows: number;
  cols: number;
  workerStart: WorkerStart | null;
  /** Worker baru dibuat untuk run ini (cold, atau warm pertama kali). */
  workerCreated: boolean;
  /** Pemuatan mesin analisis lengkap di luar timer (import logistic_enter.js / wasm init). */
  engineInitMs: number | null;
  /** Formatter SPSS produksi di main thread (di dalam jendela ukur). */
  formatMs: number | null;
  /** Dispatch → tabel SPSS selesai diformat. */
  totalMs: number | null;
  /** Mode C/D: analisis di dalam Wasm tanpa salin-masuk dan serialisasi (ms). */
  wasmCoreMs: number | null;
  /** Step-halving pada fit model akhir (fitting_warnings.step_halving_count). */
  stepHalvings: number | null;
  /** Objek hasil mentah mesin (struktur LogisticResult produksi), null bila gagal. */
  result: unknown;
  /** Tabel SPSS hasil formatter produksi, siap ditulis ke output viewer. */
  formatted: BinaryLogisticOutput | null;
  error: string | null;
}

// --- Batch ---

export interface BatchSettings {
  workload: Workload;
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
  /** Mode A (OK): import(logistic_enter.js) pertama di halaman ini. */
  enterImportMs: number | null;
  /** Mode C: import(pkg/statify_logistic.js) pertama di halaman ini. */
  wasmImportMs: number | null;
  /** Mode C: init() wasm pertama di halaman ini (fetch + compile + instantiate). */
  wasmInitMs: number | null;
}

export interface WarmWorkerInit {
  spawnMs: number;
  initMs: number;
  /** Workload "full": pemuatan mesin analisis lengkap di worker (logistic_enter.js / wasm). */
  engineInitMs?: number;
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
    /** Kolom kovariat mentah (input analisis lengkap). */
    cols: number;
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
  /** Workload "full" saja (null untuk "core"). */
  formatMs: SummaryStats | null;
  totalMs: SummaryStats | null;
  /** Mode C/D saja: durasi di dalam Wasm (inti IRLS, atau analisis tanpa serialisasi). */
  wasmCoreMs: SummaryStats | null;
}

export interface AccuracyRow {
  N: number;
  mode: ExperimentMode;
  /** max |beta(mode) - beta(D)| atas semua run mode tsb pada N ini. */
  maxAbsDiffBeta: number;
  maxAbsDiffSe: number;
  /** max |Δ| / max(1, |nilai|) atas B dan S.E. (kriteria workload "full"). */
  maxScaledDiff: number;
  iterations: number | null;
  stepHalvings: number | null;
  /** Workload "full": run yang tabel SPSS-nya identik dengan run pertama mode D. */
  tablesIdentical: { identical: number; total: number } | null;
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

/** Batch terakhir per workload (keduanya bisa ada dan ikut ditulis tombol OK). */
export type BatchResults = Record<Workload, BatchResult | null>;

export interface ExperimentResults {
  single: SingleRunResult | null;
  batches: BatchResults;
  comparison: ComparisonResult | null;
}
