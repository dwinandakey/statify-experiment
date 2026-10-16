/**
 * Ekspor hasil batch: CSV (satu baris per run, metadata lingkungan di tiap
 * baris) dan meta.json (pengaturan, lingkungan, urutan acak, ringkasan).
 * Format mesin: pemisah koma, desimal titik, angka presisi penuh.
 */
import type { AccuracyRow, BatchMeta, ModeSummary, RunRecord } from "../types/experiment";
import { MODES, REFERENCE_MODE } from "../types/experiment";

type Cell = string | number | boolean | null | undefined;

export function csvEscape(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : Number.isNaN(value) ? "NaN" : String(value);
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildRunsCsv(records: RunRecord[], meta: BatchMeta, featureNames: string[]): string {
  const env = meta.environment;
  // Workload "full": acuan tabel SPSS = run sukses pertama mode D pada N yang sama
  const refHash = new Map<number, string>();
  for (const r of records) {
    if (r.mode === REFERENCE_MODE && r.tablesHash !== null && r.error === null && !refHash.has(r.N)) refHash.set(r.N, r.tablesHash);
  }
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
    ["formatMs", (r) => r.formatMs],
    ["totalMs", (r) => r.totalMs],
    ["spawnMs", (r) => r.spawnMs],
    ["initMs", (r) => r.initMs],
    ["engineInitMs", (r) => r.engineInitMs],
    ["maxFrameGapMs", (r) => r.maxFrameGapMs],
    ["droppedFrames", (r) => r.droppedFrames],
    ["frameCount", (r) => r.frameCount],
    ["longTaskCount", (r) => r.longTaskCount],
    ["longTaskTotalMs", (r) => r.longTaskTotalMs],
    ["heapUsedMB", (r) => r.heapUsedMB],
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
    ["seed", meta.settings.seed],
    ["warmup", meta.settings.warmup],
    ["repetitions", meta.settings.repetitions],
    ["coldWorkers", meta.settings.coldWorkers],
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

  const header = [...runCols.map((c) => c[0]), ...coefCols.map((c) => c[0]), ...envValues.map((c) => c[0])];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of records) {
    const cells: Cell[] = [
      ...runCols.map(([, get]) => get(r)),
      ...coefCols.map(([, get]) => get(r)),
      ...envValues.map(([key, v]) => (key === "error" ? r.error : v)),
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
