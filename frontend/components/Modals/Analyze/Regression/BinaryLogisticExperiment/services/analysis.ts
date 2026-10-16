/**
 * Ringkasan batch (median, IQR, min, max per N × mode) dan validasi akurasi
 * antar mode (mode D sebagai acuan). Fungsi murni, tanpa akses browser.
 */
import type { AccuracyRow, ModeSummary, RunRecord } from "../types/experiment";
import { MODE_ORDER, REFERENCE_MODE } from "../types/experiment";
import { summarize } from "./metrics";

const ok = (r: RunRecord) => r.result !== null && r.error === null;

function sizesOf(records: RunRecord[]): number[] {
  return [...new Set(records.map((r) => r.N))].sort((a, b) => a - b);
}

export function computeSummaries(records: RunRecord[]): ModeSummary[] {
  const measured = records.filter((r) => r.phase === "measure");
  const out: ModeSummary[] = [];
  for (const N of sizesOf(measured)) {
    for (const mode of MODE_ORDER) {
      const rows = measured.filter((r) => r.N === N && r.mode === mode);
      if (rows.length === 0) continue;
      const good = rows.filter(ok);
      out.push({
        N,
        mode,
        runs: rows.length,
        errors: rows.length - good.length,
        computeMs: summarize(good.map((r) => r.computeMs)),
        e2eMs: summarize(good.map((r) => r.e2eMs)),
        maxFrameGapMs: summarize(good.map((r) => r.maxFrameGapMs)),
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

/**
 * Untuk setiap N: selisih absolut maksimum beta dan SE tiap mode terhadap run
 * pertama mode D, diambil atas SEMUA run sukses mode tersebut (sekaligus
 * menguji determinisme antar ulangan).
 */
export function computeAccuracy(records: RunRecord[]): AccuracyRow[] {
  const out: AccuracyRow[] = [];
  for (const N of sizesOf(records)) {
    const atN = records.filter((r) => r.N === N && ok(r));
    const ref = atN.find((r) => r.mode === REFERENCE_MODE)?.result;
    if (!ref) continue;
    for (const mode of MODE_ORDER) {
      const rows = atN.filter((r) => r.mode === mode);
      if (rows.length === 0) continue;
      let db = 0;
      let ds = 0;
      for (const r of rows) {
        db = Math.max(db, maxAbsDiff(r.result!.beta, ref.beta));
        ds = Math.max(ds, maxAbsDiff(r.result!.se, ref.se));
      }
      out.push({
        N,
        mode,
        maxAbsDiffBeta: db,
        maxAbsDiffSe: ds,
        iterations: rows[0].result!.iterations,
        stepHalvings: rows[0].result!.stepHalvings,
      });
    }
  }
  return out;
}

/** Selisih maksimum lintas mode per N (dipakai untuk status lulus/gagal 1e-8). */
export function worstAccuracyByN(rows: AccuracyRow[]): { N: number; beta: number; se: number }[] {
  const byN = new Map<number, { beta: number; se: number }>();
  for (const r of rows) {
    const cur = byN.get(r.N) ?? { beta: 0, se: 0 };
    byN.set(r.N, { beta: Math.max(cur.beta, r.maxAbsDiffBeta), se: Math.max(cur.se, r.maxAbsDiffSe) });
  }
  return [...byN.entries()].map(([N, v]) => ({ N, ...v }));
}
