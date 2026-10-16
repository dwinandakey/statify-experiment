/**
 * Pipeline tabel SPSS analisis lengkap, dipakai tombol OK dan batch workload
 * "full": hasil mentah mesin (A/B: logistic_enter.js, C/D:
 * calculate_binary_logistic) → payload seperti worker produksi (model_info,
 * method_used) → formatter produksi `formatBinaryLogisticResult` dengan opsi
 * default dialog produksi. Fungsi murni (tanpa store), aman dipanggil per run.
 */
import type { Variable } from "@/types/Variable";
import { formatBinaryLogisticResult } from "@/components/Modals/Analyze/Regression/BinaryLogistic/services/formatter";
import {
  DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS as DEFAULT_OPTIONS,
  type BinaryLogisticOutput,
  type LogisticResult,
} from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import type { CoreResult, FullAnalysisInput } from "../types/experiment";

export const METHOD = "Enter" as const;

type ModelInfo = FullAnalysisInput["modelInfo"];

/**
 * Lengkapi hasil mentah mesin seperti worker produksi sebelum diformat:
 * cek classification_table, method_used, dan model_info (encoding Y/X,
 * jumlah kasus, nama variabel).
 */
export function toProductionPayload(raw: unknown, modelInfo: ModelInfo): LogisticResult {
  const result = raw as (LogisticResult & { step_history?: { step: number }[] }) | null;
  if (!result || !result.classification_table) throw new Error("Calculation failed in backend.");
  const history = result.step_history;
  return {
    ...result,
    method_used: METHOD,
    model_info: {
      ...modelInfo,
      step_number: history && history.length > 0 ? history[history.length - 1].step : 0,
    },
  } as LogisticResult;
}

/** Tabel SPSS persis seperti dialog produksi (metode Enter, opsi default). */
export function formatSpssTables(
  raw: unknown,
  modelInfo: ModelInfo,
  dependent: Variable,
  covariates: Variable[]
): BinaryLogisticOutput {
  return formatBinaryLogisticResult(toProductionPayload(raw, modelInfo), dependent, covariates, {
    displayAtLastStep: !DEFAULT_OPTIONS.displayAtEachStep,
    ciForExpB: DEFAULT_OPTIONS.ciForExpB,
    ciLevel: DEFAULT_OPTIONS.ciLevel,
    cutoff: DEFAULT_OPTIONS.classificationCutoff,
    casewiseOutliers: DEFAULT_OPTIONS.casewiseOutliers,
  });
}

const finiteOrNaN = (v: unknown) => (typeof v === "number" ? v : NaN);

/**
 * Step-halving pada fit model akhir: `fitting_warnings.step_halving_count`
 * (Rust irls::fit dan port JS). Objek itu hanya ada bila ada peringatan atau
 * step-halving, jadi bila tidak ada nilainya 0.
 */
export function stepHalvingsFromResult(raw: unknown): number {
  const warnings = (raw as { fitting_warnings?: { step_halving_count?: unknown } } | null)?.fitting_warnings;
  return warnings ? finiteOrNaN(warnings.step_halving_count) : 0;
}

/**
 * B dan S.E. dari tabel Variables in the Equation hasil analisis lengkap,
 * urut sesuai featureNames (Constant, kovariat, dummy `nama(j)`), dicocokkan
 * lewat label seperti compareWithProduction; baris grup kategorik (tanpa B)
 * otomatis terlewati. Label yang tidak ada (mis. kategori hilang setelah
 * resampling) dan nilai non-finite (null dari serde) menjadi NaN.
 */
export function coefficientsFromResult(raw: unknown, featureNames: string[]): CoreResult {
  const result = raw as Partial<LogisticResult> | null;
  const rows = result?.variables_in_equation ?? [];
  const used = new Set<number>();
  const beta: number[] = [];
  const se: number[] = [];
  for (const name of featureNames) {
    const idx = rows.findIndex((r, i) => !used.has(i) && r.label === name);
    if (idx >= 0) used.add(idx);
    beta.push(idx >= 0 ? finiteOrNaN(rows[idx].b) : NaN);
    se.push(idx >= 0 ? finiteOrNaN(rows[idx].error) : NaN);
  }
  const ll = result?.model_summary?.log_likelihood;
  return {
    beta,
    se,
    neg2ll: typeof ll === "number" ? -2 * ll : NaN,
    iterations: finiteOrNaN(result?.model_summary?.iterations),
    converged: result?.model_summary?.converged === true,
    stepHalvings: stepHalvingsFromResult(raw),
    wasmCoreMs: null,
  };
}

/**
 * Hash 53-bit (cyrb53) isi teks, 14 digit hex. Dipakai untuk membandingkan
 * tabel SPSS antar run tanpa menyimpan seluruh tabelnya.
 */
export function hashText(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Sidik isi tabel SPSS (judul, deskripsi, header, sel) untuk uji identik antar mode. */
export function spssTablesHash(output: BinaryLogisticOutput): string {
  return hashText(JSON.stringify(output.sections ?? []));
}
