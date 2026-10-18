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

// --- Sel desain v2: mode × siklus hidup worker ---

/**
 * Siklus hidup worker dalam batch:
 * - "persistent": 4 sel (A, B-warm, C, D-warm), worker dibuat sekali sebelum pengukuran;
 * - "per-run": 4 sel (A, B-cold, C, D-cold), worker baru untuk setiap run;
 * - "interleaved": 6 sel (A, B-warm, B-cold, C, D-warm, D-cold) di setiap repetisi.
 */
export type Lifecycle = "persistent" | "per-run" | "interleaved";

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  persistent: "Persistent",
  "per-run": "Per-run",
  interleaved: "Interleaved",
};

export type CellId = "A" | "B-warm" | "B-cold" | "C" | "D-warm" | "D-cold";

export interface Cell {
  id: CellId;
  mode: ExperimentMode;
  /** null untuk mode main thread (A, C). */
  workerStart: WorkerStart | null;
}

export const CELLS: Record<CellId, Cell> = {
  A: { id: "A", mode: "A", workerStart: null },
  "B-warm": { id: "B-warm", mode: "B", workerStart: "warm" },
  "B-cold": { id: "B-cold", mode: "B", workerStart: "cold" },
  C: { id: "C", mode: "C", workerStart: null },
  "D-warm": { id: "D-warm", mode: "D", workerStart: "warm" },
  "D-cold": { id: "D-cold", mode: "D", workerStart: "cold" },
};

/**
 * Urutan kanonik sel sebelum diacak. Untuk persistent/per-run hasilnya A, B, C, D seperti
 * MODE_ORDER v1, jadi urutan acak per repetisi identik dengan v1 untuk orderSeed = seed v1.
 */
export const CELL_ORDER: CellId[] = ["A", "B-warm", "B-cold", "C", "D-warm", "D-cold"];

export function cellsFor(lifecycle: Lifecycle): Cell[] {
  return CELL_ORDER.map((id) => CELLS[id]).filter(
    (c) => c.workerStart === null || lifecycle === "interleaved" || c.workerStart === (lifecycle === "per-run" ? "cold" : "warm")
  );
}

/** Sel untuk satu run (Run once, OK, atau baris CSV lama tanpa kolom cell). */
export function cellFor(mode: ExperimentMode, cold: boolean): Cell {
  if (MODES[mode].location === "main") return CELLS[mode as "A" | "C"];
  return CELLS[`${mode}-${cold ? "cold" : "warm"}` as CellId];
}

export function cellLabel(id: CellId): string {
  const c = CELLS[id];
  return c.workerStart ? `${MODES[c.mode].label} (${c.workerStart === "warm" ? "persistent" : "per-run"})` : MODES[c.mode].label;
}

/**
 * Acuan validasi akurasi antar sel: run sukses pertama sel D-warm pada N yang sama
 * (konfigurasi produksi). Batch per-run tidak punya D-warm, jadi memakai D-cold.
 */
export const REFERENCE_CELLS: CellId[] = ["D-warm", "D-cold"];

// --- Sampling dan urutan ---

/**
 * Pembentukan dataset ukuran N:
 * - "resample": dengan pengembalian, mulberry32(dataSeed) (perilaku v1);
 * - "prefix": N baris pertama data yang sudah dipersiapkan, tanpa pengembalian (N ≤ n).
 */
export type Sampling = "resample" | "prefix";

/** Urutan ukuran N dalam batch: naik (v1) atau diacak dengan orderSeed. */
export type SizeOrder = "ascending" | "shuffled";

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
  /** true hanya untuk sampling "resample" dengan N berbeda dari N asli. */
  resampled: boolean;
  /** "original" bila N = N asli (data dipakai apa adanya), selain itu cara sampling-nya. */
  sampling: "original" | Sampling;
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
  /**
   * Sel cold: responsivitas main thread selama start-up worker, diukur FrameMonitor kedua dari
   * tepat sebelum `new Worker` sampai worker siap (termasuk init_full), di luar jendela ukur.
   * null untuk sel lain.
   */
  spawnMaxFrameGapMs: number | null;
  spawnDroppedFrames: number | null;
  /** null juga bila longtask tidak didukung (Firefox). */
  spawnLongTaskCount: number | null;
  /**
   * Mode worker: rincian overheadMs dari stempel epoch (performance.timeOrigin + now()) di main
   * thread dan worker. dispatch = tRecv − t0, return = t1 − tPost, handler = tPost − tRecv.
   * null untuk mode main.
   */
  dispatchLatencyMs: number | null;
  returnLatencyMs: number | null;
  workerHandlerMs: number | null;
  /** true bila salah satu dari tiga nilai di atas < −0,05 ms (jam antarkonteks tidak konsisten). */
  clockCheckFailed: boolean | null;
  /** Fase frame dari stempel rAF FrameMonitor: t0 − rAF terakhir ≤ t0. */
  t0PhaseMs: number | null;
  /** t1 − rAF terakhir ≤ t1. */
  t1PhaseMs: number | null;
  /** rAF pertama > t1 dikurangi t1. */
  nextFrameAfterT1Ms: number | null;
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
  /** Posisi sel dalam urutan acak ulangan tersebut (1..4, atau 1..6 untuk interleaved). */
  orderInRep: number;
  mode: ExperimentMode;
  workerStart: WorkerStart | null;
  /** Sel desain: mode + siklus hidup worker. */
  cell: CellId;
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
  cell: CellId;
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
  /** Seed resampling; hanya dipakai sampling "resample". Menggantikan `seed` v1. */
  dataSeed: number;
  /** Seed urutan sel per repetisi, urutan N ("shuffled"), dan urutan workload (orkestrator). */
  orderSeed: number;
  sampling: Sampling;
  sizeOrder: SizeOrder;
  /** Menggantikan `coldWorkers` v1 (true → "per-run", false → "persistent"). */
  lifecycle: Lifecycle;
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
  /** `git describe --always --dirty --abbrev=8` saat build (akhiran -dirty bila working tree berubah). */
  gitCommit: string | null;
  /** Estimasi interval refresh layar (median gap rAF saat idle). */
  refreshIntervalMs: number | null;
  /** Estimasi resolusi performance.now() (selisih positif terkecil). */
  timerResolutionMs: number | null;
  longTaskSupported: boolean;
  memoryApiSupported: boolean;
  capturedAt: string;
  /** "chrome", "edge", "chromium", "firefox", atau "unknown". */
  browserName: string;
  /** Versi lengkap: Chromium dari userAgentData.fullVersionList, Firefox dari UA "Firefox/x.y". */
  browserVersion: string | null;
  /** navigator.userAgentData.getHighEntropyValues (Chromium); null di Firefox. */
  uaHighEntropy: {
    fullVersionList?: { brand: string; version: string }[];
    platformVersion?: string;
    architecture?: string;
    bitness?: string;
  } | null;
  webdriver: boolean | null;
  /** document.hasFocus() dan visibilityState di awal batch dan (diisi setelah batch) di akhir. */
  hasFocusStart: boolean | null;
  visibilityStart: string | null;
  hasFocusEnd: boolean | null;
  visibilityEnd: string | null;
  devicePixelRatio: number | null;
  innerWidth: number | null;
  innerHeight: number | null;
  /** navigator.getBattery() (Chromium); null bila tidak ada. */
  battery: { charging: boolean; level: number } | null;
  /** Isi `files` ARTIFACT_HASHES.json yang disajikan bersama build. */
  artifactHashes: Record<string, { bytes: number; sha256: string }> | null;
  /** SHA-256 .wasm yang di-fetch saat batch dimulai (crypto.subtle). */
  wasmSha256Runtime: string | null;
  /** wasmSha256Runtime sama dengan ARTIFACT_HASHES.json; null bila salah satunya tidak tersedia. */
  wasmHashVerified: boolean | null;
}

/** Info sesi dari query URL (expSession, expSessionIndex, expRole, expBrowser), diisi orkestrator. */
export interface SessionInfo {
  id: string | null;
  index: number | null;
  role: "pilot" | "measure" | null;
  browser: string | null;
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
  /** Urutan ukuran N yang benar-benar dipakai (naik, atau diacak dengan orderSeed). */
  sizeOrderUsed: number[];
  /** Urutan sel yang dipakai tiap (N, ulangan); untuk audit pengacakan. */
  orders: { N: number; rep: number; order: CellId[] }[];
  /** Info sesi orkestrator dari query URL; null untuk batch manual. */
  session: SessionInfo | null;
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
  cell: CellId;
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
  cell: CellId;
  /** Sel acuan (run sukses pertama D-warm, atau D-cold untuk batch per-run). */
  referenceCell: CellId;
  /** max |beta(sel) - beta(acuan)| atas semua run sel tsb pada N ini. */
  maxAbsDiffBeta: number;
  maxAbsDiffSe: number;
  /** max |Δ| / max(1, |nilai|) atas B dan S.E. (kriteria workload "full"). */
  maxScaledDiff: number;
  iterations: number | null;
  stepHalvings: number | null;
  /** Workload "full": run yang tabel SPSS-nya identik dengan run acuan. */
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
  sampling: DatasetForRun["sampling"];
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
