/** Format angka untuk tampilan (CSV tetap memakai presisi penuh). */

export function fmtMs(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtNum(v: number | null | undefined, digits = 6): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
  return v.toFixed(digits);
}

/** Selisih kecil (validasi akurasi): notasi ilmiah, 0 tetap "0". */
export function fmtDiff(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return "∞";
  return v.toExponential(2);
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtMB(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${v.toFixed(1)} MB`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
