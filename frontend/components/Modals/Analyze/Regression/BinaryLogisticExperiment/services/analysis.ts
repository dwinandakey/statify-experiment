/**
 * Ringkasan batch (median, IQR, min, max per N × sel) dan validasi akurasi
 * antar sel (run sukses pertama D-warm sebagai acuan; D-cold untuk batch
 * per-run). Fungsi murni, tanpa akses browser.
 */
import type { AccuracyRow, CellId, ModeSummary, RunRecord } from "../types/experiment";
import { CELLS, CELL_ORDER, REFERENCE_CELLS } from "../types/experiment";
import { summarize } from "./metrics";

/** Ambang kesamaan antar mode (kriteria selesai). */
export const MODE_AGREEMENT_TOL = 1e-8;

const ok = (r: RunRecord) => r.result !== null && r.error === null;

function sizesOf(records: RunRecord[]): number[] {
  return [...new Set(records.map((r) => r.N))].sort((a, b) => a - b);
}

/** Ringkasan metrik yang hanya ada di workload "full" (null bila tidak ada nilai). */
function summarizeOptional(values: (number | null)[]) {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? summarize(present) : null;
}

export function computeSummaries(records: RunRecord[]): ModeSummary[] {
  const measured = records.filter((r) => r.phase === "measure");
  const out: ModeSummary[] = [];
  for (const N of sizesOf(measured)) {
    for (const cell of CELL_ORDER) {
      const rows = measured.filter((r) => r.N === N && r.cell === cell);
      if (rows.length === 0) continue;
      const good = rows.filter(ok);
      out.push({
        N,
        mode: CELLS[cell].mode,
        cell,
        runs: rows.length,
        errors: rows.length - good.length,
        computeMs: summarize(good.map((r) => r.computeMs)),
        e2eMs: summarize(good.map((r) => r.e2eMs)),
        maxFrameGapMs: summarize(good.map((r) => r.maxFrameGapMs)),
        formatMs: summarizeOptional(good.map((r) => r.formatMs)),
        totalMs: summarizeOptional(good.map((r) => r.totalMs)),
        wasmCoreMs: summarizeOptional(good.map((r) => r.result?.wasmCoreMs ?? null)),
      });
    }
  }
  return out;
}

export function maxAbsDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!(d <= m)) m = d; // NaN ikut terbawa sebagai selisih maksimum
  }
  return m;
}

/** Selisih berskala |a − b| / max(1, |a|, |b|): relatif untuk nilai besar (mis. S.E. pada separasi). */
export function maxScaledDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
    if (!(d <= m)) m = d;
  }
  return m;
}

/**
 * Run acuan pada satu N: run sukses pertama sel D-warm; bila tidak ada (batch per-run),
 * run sukses pertama D-cold. Dipakai juga kolom CSV tablesIdenticalToD.
 */
export function referenceRecord(recordsAtN: RunRecord[]): RunRecord | undefined {
  for (const cell of REFERENCE_CELLS) {
    const hit = recordsAtN.find((r) => r.cell === cell && ok(r));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Untuk setiap N: selisih absolut maksimum beta dan SE tiap sel terhadap run
 * acuan (referenceRecord), diambil atas SEMUA run sukses sel tersebut (sekaligus
 * menguji determinisme antar ulangan). Workload "full" juga menghitung berapa
 * run yang tabel SPSS-nya identik dengan run acuan tersebut.
 */
export function computeAccuracy(records: RunRecord[]): AccuracyRow[] {
  const out: AccuracyRow[] = [];
  for (const N of sizesOf(records)) {
    const atN = records.filter((r) => r.N === N && ok(r));
    const refRecord = referenceRecord(atN);
    const ref = refRecord?.result;
    if (!refRecord || !ref) continue;
    for (const cell of CELL_ORDER) {
      const rows = atN.filter((r) => r.cell === cell);
      if (rows.length === 0) continue;
      let db = 0;
      let ds = 0;
      let scaled = 0;
      for (const r of rows) {
        db = Math.max(db, maxAbsDiff(r.result!.beta, ref.beta));
        ds = Math.max(ds, maxAbsDiff(r.result!.se, ref.se));
        scaled = Math.max(scaled, maxScaledDiff(r.result!.beta, ref.beta), maxScaledDiff(r.result!.se, ref.se));
      }
      out.push({
        N,
        mode: CELLS[cell].mode,
        cell,
        referenceCell: refRecord.cell as CellId,
        maxAbsDiffBeta: db,
        maxAbsDiffSe: ds,
        maxScaledDiff: scaled,
        iterations: rows[0].result!.iterations,
        stepHalvings: rows[0].result!.stepHalvings,
        tablesIdentical:
          refRecord.tablesHash === null
            ? null
            : { identical: rows.filter((r) => r.tablesHash === refRecord.tablesHash).length, total: rows.length },
      });
    }
  }
  return out;
}

/**
 * Kriteria lulus satu baris akurasi. Inti IRLS (kode identik): |ΔB| dan
 * |ΔS.E.| < 1e-8. Analisis lengkap (port JS vs Rust): semua tabel SPSS
 * identik dengan mode D dan selisih berskala B/S.E. < 1e-8.
 */
export function accuracyPassed(row: AccuracyRow): boolean {
  if (row.tablesIdentical) {
    return row.tablesIdentical.identical === row.tablesIdentical.total && row.maxScaledDiff < MODE_AGREEMENT_TOL;
  }
  return row.maxAbsDiffBeta < MODE_AGREEMENT_TOL && row.maxAbsDiffSe < MODE_AGREEMENT_TOL;
}

/** Ringkasan per N untuk status lulus/gagal di dialog. */
export function worstAccuracyByN(rows: AccuracyRow[]): { N: number; beta: number; se: number; passed: boolean }[] {
  const byN = new Map<number, { beta: number; se: number; passed: boolean }>();
  for (const r of rows) {
    const cur = byN.get(r.N) ?? { beta: 0, se: 0, passed: true };
    byN.set(r.N, {
      beta: Math.max(cur.beta, r.maxAbsDiffBeta),
      se: Math.max(cur.se, r.maxAbsDiffSe),
      passed: cur.passed && accuracyPassed(r),
    });
  }
  return [...byN.entries()].map(([N, v]) => ({ N, ...v }));
}
