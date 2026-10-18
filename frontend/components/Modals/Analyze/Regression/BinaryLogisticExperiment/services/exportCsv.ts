/**
 * Ekspor hasil batch: CSV (satu baris per run, metadata lingkungan di tiap
 * baris) dan meta.json (pengaturan, lingkungan, urutan acak, ringkasan).
 * Format mesin: pemisah koma, desimal titik, angka presisi penuh.
 *
 * Urutan kolom v1 tidak berubah; kolom v2 ditambahkan di BELAKANG (setelah
 * batchStartedAt), sehingga skrip analisis v1 tetap bisa membaca berkas baru.
 */
import type { AccuracyRow, BatchMeta, ModeSummary, RunRecord } from "../types/experiment";
import { MODES } from "../types/experiment";
import { referenceRecord } from "./analysis";
import { legacyColdWorkers } from "./settings";

type Cell = string | number | boolean | null | undefined;

export function csvEscape(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : Number.isNaN(value) ? "NaN" : String(value);
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildRunsCsv(records: RunRecord[], meta: BatchMeta, featureNames: string[]): string {
  const env = meta.environment;
  const s = meta.settings;
  // Workload "full": acuan tabel SPSS = run sukses pertama D-warm (atau D-cold) pada N yang sama
  const refHash = new Map<number, string>();
  for (const N of new Set(records.map((r) => r.N))) {
    const ref = referenceRecord(records.filter((r) => r.N === N));
    if (ref && ref.tablesHash !== null) refHash.set(N, ref.tablesHash);
  }
  const sizeOrderIndex = new Map((meta.sizeOrderUsed ?? []).map((N, i) => [N, i + 1]));
  const session = meta.session ?? null;
  const runCols: [string, (r: RunRecord) => Cell][] = [
    ["batchId", (r) => r.batchId],
    ["workload", (r) => r.workload],
    ["runIndex", (r) => r.runIndex],
    ["timestamp", (r) => r.timestamp],
    ["N", (r) => r.N],
    ["p", (r) => r.p],
    ["rep", (r) => r.rep],
    ["orderInRep", (r) => r.orderInRep],
    ["mode", (r) => r.mode],
    ["technology", (r) => MODES[r.mode].technology],
    ["location", (r) => MODES[r.mode].location],
    ["workerStart", (r) => r.workerStart],
    ["computeMs", (r) => r.computeMs],
    ["e2eMs", (r) => r.e2eMs],
    ["overheadMs", (r) => r.overheadMs],
    ["wasmCoreMs", (r) => r.result?.wasmCoreMs ?? null],
    ["wasmSerializeMs", (r) => r.wasmSerializeMs],
    ["formatMs", (r) => r.formatMs],
    ["totalMs", (r) => r.totalMs],
    ["spawnMs", (r) => r.spawnMs],
    ["initMs", (r) => r.initMs],
    ["engineInitMs", (r) => r.engineInitMs],
    ["maxFrameGapMs", (r) => r.maxFrameGapMs],
    ["droppedFrames", (r) => r.droppedFrames],
    ["longGapCount", (r) => r.longGapCount],
    ["frameCount", (r) => r.frameCount],
    ["frameIntervalMs", (r) => r.frameIntervalMs],
    ["longTaskCount", (r) => r.longTaskCount],
    ["longTaskTotalMs", (r) => r.longTaskTotalMs],
    ["mainHeapUsedMB", (r) => r.mainHeapUsedMB],
    ["wasmMemoryMB", (r) => r.wasmMemoryMB],
    ["pageHidden", (r) => r.pageHidden],
    ["iterations", (r) => r.result?.iterations ?? null],
    ["converged", (r) => r.result?.converged ?? null],
    ["stepHalvings", (r) => r.result?.stepHalvings ?? null],
    ["neg2ll", (r) => r.result?.neg2ll ?? null],
    ["tablesHash", (r) => r.tablesHash],
    ["tablesIdenticalToD", (r) => (r.tablesHash === null ? null : r.tablesHash === refHash.get(r.N))],
  ];
  const coefCols: [string, (r: RunRecord) => Cell][] = [
    ...featureNames.map((name, j): [string, (r: RunRecord) => Cell] => [`B_${name}`, (r) => r.result?.beta[j] ?? null]),
    ...featureNames.map((name, j): [string, (r: RunRecord) => Cell] => [`SE_${name}`, (r) => r.result?.se[j] ?? null]),
  ];
  const envValues: [string, Cell][] = [
    ["error", null], // diisi per baris di bawah
    // v1: satu seed untuk resampling dan urutan; v2: seed data (lihat juga dataSeed/orderSeed)
    ["seed", s.dataSeed],
    ["warmup", s.warmup],
    ["repetitions", s.repetitions],
    // v1: pengaturan batch; kosong untuk batch interleaved (lihat lifecycle dan workerStart)
    ["coldWorkers", legacyColdWorkers(s.lifecycle)],
    ["maxIter", meta.settings.maxIter],
    ["tol", meta.settings.tol],
    ["dependent", meta.dataset.dependent],
    ["covariates", meta.dataset.covariates.join(";")],
    ["nOriginal", meta.dataset.nOriginal],
    ["mainJsImportMs", meta.mainThreadInit.jsImportMs],
    ["mainEnterImportMs", meta.mainThreadInit.enterImportMs],
    ["mainWasmImportMs", meta.mainThreadInit.wasmImportMs],
    ["mainWasmInitMs", meta.mainThreadInit.wasmInitMs],
    ["warmSpawnMsB", meta.warmWorkerInit.B?.spawnMs ?? null],
    ["warmInitMsB", meta.warmWorkerInit.B?.initMs ?? null],
    ["warmSpawnMsD", meta.warmWorkerInit.D?.spawnMs ?? null],
    ["warmInitMsD", meta.warmWorkerInit.D?.initMs ?? null],
    ["warmEngineInitMsB", meta.warmWorkerInit.B?.engineInitMs ?? null],
    ["warmEngineInitMsD", meta.warmWorkerInit.D?.engineInitMs ?? null],
    ["userAgent", env.userAgent],
    ["hardwareConcurrency", env.hardwareConcurrency],
    ["deviceMemory", env.deviceMemory],
    ["crossOriginIsolated", env.crossOriginIsolated],
    ["refreshIntervalMs", env.refreshIntervalMs],
    ["timerResolutionMs", env.timerResolutionMs],
    ["buildMode", env.buildMode],
    ["gitCommit", env.gitCommit],
    ["batchStartedAt", meta.startedAt],
  ];
  // --- Kolom v2, di belakang semua kolom v1 ---
  const v2Cols: [string, (r: RunRecord) => Cell][] = [
    // Tugas 3: sampling dan seed
    ["sampling", () => s.sampling],
    ["dataSeed", () => s.dataSeed],
    ["orderSeed", () => s.orderSeed],
    ["sizeOrder", () => s.sizeOrder],
    ["sizeOrderIndex", (r) => sizeOrderIndex.get(r.N) ?? null],
    // Tugas 4: sel dan start-up per-run
    ["cell", (r) => r.cell],
    ["lifecycle", () => s.lifecycle],
    ["spawnMaxFrameGapMs", (r) => r.spawnMaxFrameGapMs],
    ["spawnDroppedFrames", (r) => r.spawnDroppedFrames],
    ["spawnLongTaskCount", (r) => r.spawnLongTaskCount],
    // Tugas 5: rincian overhead worker, fase frame, sesi, browser
    ["dispatchLatencyMs", (r) => r.dispatchLatencyMs],
    ["returnLatencyMs", (r) => r.returnLatencyMs],
    ["workerHandlerMs", (r) => r.workerHandlerMs],
    ["clockCheckFailed", (r) => r.clockCheckFailed],
    ["t0PhaseMs", (r) => r.t0PhaseMs],
    ["t1PhaseMs", (r) => r.t1PhaseMs],
    ["nextFrameAfterT1Ms", (r) => r.nextFrameAfterT1Ms],
    ["sessionId", () => session?.id ?? null],
    ["sessionIndex", () => session?.index ?? null],
    ["sessionRole", () => session?.role ?? null],
    ["browserName", () => env.browserName ?? null],
    ["browserVersion", () => env.browserVersion ?? null],
  ];

  const header = [
    ...runCols.map((c) => c[0]),
    ...coefCols.map((c) => c[0]),
    ...envValues.map((c) => c[0]),
    ...v2Cols.map((c) => c[0]),
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of records) {
    const cells: Cell[] = [
      ...runCols.map(([, get]) => get(r)),
      ...coefCols.map(([, get]) => get(r)),
      ...envValues.map(([key, v]) => (key === "error" ? r.error : v)),
      ...v2Cols.map(([, get]) => get(r)),
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function buildMetaJson(
  meta: BatchMeta,
  summaries: ModeSummary[],
  accuracy: AccuracyRow[],
  featureNames: string[]
): string {
  return JSON.stringify({ ...meta, featureNames, summaries, accuracy }, null, 2);
}

/** Simpan teks sebagai file unduhan (Blob + object URL). */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
