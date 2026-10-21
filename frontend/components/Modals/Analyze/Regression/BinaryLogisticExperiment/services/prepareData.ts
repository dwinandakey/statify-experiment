/**
 * Persiapan data bersama untuk keempat mode eksperimen. Dijalankan SEKALI di
 * main thread, di luar jendela pengukuran waktu.
 *
 * Aturannya disalin dari pipeline produksi supaya design matrix X identik
 * dengan yang dibangun Enter produksi:
 * - worker produksi public/workers/Regression/binaryLogistic.worker.js:
 *   filter `cleanData` (listwise deletion), `processCovariates` (encoding
 *   kovariat), `processDependentVariable` (encoding Y);
 * - Rust rust/src/stats/design_matrix.rs `build` (dummy coding kategorik:
 *   kategori diurutkan numerik, Indicator dengan referensi Last, nama
 *   kolom `nama(j)`), lalu strategies/enter.rs menyisipkan intercept di kolom 0.
 */
import type { DataRow } from "@/types/Data";
import type { Variable } from "@/types/Variable";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { CategoricalCoding, DatasetForRun, FullAnalysisInput, PreparedData, Sampling } from "../types/experiment";
import { mulberry32 } from "./prng";

/**
 * Cari variabel terkini di store (id → columnIndex → name), sama seperti
 * `findActualVariable` di BinaryLogisticMain.tsx produksi.
 */
export function findActualVariable(currentVariables: Variable[], target: Variable): Variable | null {
  let found = currentVariables.find((v) => v.id === target.id);
  if (found) return found;
  if (target.columnIndex !== undefined) {
    found = currentVariables.find((v) => v.columnIndex === target.columnIndex);
    if (found) return found;
  }
  found = currentVariables.find((v) => v.name === target.name);
  return found ?? null;
}

/**
 * Kovariat nominal/ordinal diperlakukan kategorik (sama dengan deteksi
 * otomatis produksi) dengan kontras default produksi: Indicator, referensi Last.
 */
export function isCategoricalCovariate(v: Variable): boolean {
  const measure = v.measure?.toLowerCase();
  return measure === "nominal" || measure === "ordinal";
}

/**
 * Variabel STRING dengan ukuran scale tidak pernah bisa dipakai (produksi
 * juga gagal: nilai teks tidak bisa dijadikan angka), jadi ditolak lebih awal.
 */
export function covariateRejectionReason(v: Variable): string | null {
  if (v.type === "STRING" && !isCategoricalCovariate(v)) {
    return `Covariate "${v.name}" is a string variable with measurement level ${v.measure}. Set its measurement level to Nominal or Ordinal so it is treated as categorical.`;
  }
  return null;
}

const isMissing = (val: unknown) => val === null || val === undefined || val === "";

/**
 * Salinan `processDependentVariable` produksi. Catatan: `.sort()` tanpa
 * comparator mengurutkan sebagai STRING (mis. "10" < "9"); nilai pertama → 0.
 */
export function encodeDependent(rawY: (string | number)[]): {
  yVector: number[];
  yMap: Record<string, number>;
} {
  const uniqueVals = [...new Set(rawY)].sort();
  if (uniqueVals.length !== 2) {
    throw new Error(
      `Binary Logistic Regression requires exactly 2 levels for Y. Found: ${uniqueVals.length} (${uniqueVals.join(", ")})`
    );
  }
  const map: Record<string, number> = { [uniqueVals[0]]: 0.0, [uniqueVals[1]]: 1.0 };
  const yVector = rawY.map((v) => map[String(v)]);
  return { yVector, yMap: map };
}

/**
 * Dummy coding Indicator (referensi Last) untuk satu kovariat kategorik,
 * mengikuti dua tahap produksi:
 * 1. worker JS (`processCovariates`): nilai unik diurutkan (numerik bila
 *    keduanya angka, selain itu localeCompare); bila semua angka kodenya
 *    = nilai itu sendiri, bila tidak kodenya = indeks urutan;
 * 2. Rust (`design_matrix::build`): kode unik diurutkan numerik, kategori
 *    terakhir menjadi referensi (semua dummy 0), kategori ke-j (1-based)
 *    menjadi kolom `nama(j)` bernilai 1.
 */
export function encodeCategorical(
  rawValues: (string | number)[],
  name: string
): {
  columns: Float64Array[];
  coding: CategoricalCoding;
  /** Kode tahap-1 per baris (masukan calculate_binary_logistic). */
  rawCodes: Float64Array;
  /** Entri x_encodings produksi: nilai asli (string) → kode. */
  encoding: Record<string, number>;
} {
  const sortedValues = Array.from(new Set(rawValues)).sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b));
  });
  const isAllNumeric = sortedValues.every((val) => !isNaN(Number(val)) && val !== "");
  const codeMap = new Map<string, number>();
  sortedValues.forEach((val, index) => {
    codeMap.set(String(val), isAllNumeric ? Number(val) : index + 0.0);
  });

  const rowCodes = rawValues.map((v) => codeMap.get(String(v)) ?? 0.0);
  const categoryCodes = Array.from(new Set(rowCodes)).sort((a, b) => a - b);
  if (categoryCodes.length < 2) {
    throw new Error(
      `Categorical covariate "${name}" has only ${categoryCodes.length} category after listwise deletion; at least 2 are required.`
    );
  }

  const n = rawValues.length;
  const k = categoryCodes.length;
  const columns = Array.from({ length: k - 1 }, () => new Float64Array(n));
  const frequency = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const c = categoryCodes.indexOf(rowCodes[i]);
    frequency[c]++;
    if (c < k - 1) columns[c][i] = 1;
  }

  // Label kategori: nilai asli pertama (urutan produksi) yang menghasilkan kode tsb
  const labelOf = (code: number) => String(sortedValues.find((v) => codeMap.get(String(v)) === code) ?? code);
  return {
    columns,
    coding: {
      variable: name,
      categories: categoryCodes.map((code, c) => ({ label: labelOf(code), code, frequency: frequency[c] })),
      dummyNames: Array.from({ length: k - 1 }, (_, j) => `${name}(${j + 1})`),
    },
    rawCodes: Float64Array.from(rowCodes),
    encoding: Object.fromEntries(codeMap),
  };
}

/**
 * rustConfig seperti yang dibangun binaryLogistic.worker.js produksi dari
 * analysisConfig dialog produksi (metode Enter, DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS).
 */
export function buildProductionRustConfig(categoricalColumnIndices: number[]): string {
  return JSON.stringify({
    dependent_index: 0,
    independent_indices: [],
    categoricalVariables: categoricalColumnIndices.map((columnIndex) => ({
      columnIndex,
      method: "Indicator",
      reference: "Last",
    })),
    max_iterations: 20,
    convergence_threshold: 0.001,
    include_constant: true,
    confidence_level: 95,
    cutoff: 0.5,
    method: "Enter",
    p_entry: 0.05,
    p_removal: 0.1,
    hosmer_lemeshow: false,
    classification_plots: false,
    casewise_listing: false,
    casewise_type: "outliers",
    casewise_outliers: 2.0,
    iteration_history: false,
    correlations: false,
    display_at_last_step: false,
    save_predicted_probabilities: false,
    save_predicted_group: false,
    save_residuals_unstandardized: false,
    save_residuals_logit: false,
    save_residuals_studentized: false,
    save_residuals_standardized: false,
    save_residuals_deviance: false,
    save_influence_cooks: false,
    save_influence_leverage: false,
    save_influence_dfbeta: false,
    assumptions: { multicollinearity: false, box_tidwell: false },
  });
}

export function prepareExperimentData(
  data: DataRow[],
  variables: Variable[],
  dependent: Variable | null,
  covariates: Variable[]
): PreparedData {
  if (!dependent) throw new Error("Please select a dependent variable.");
  if (covariates.length === 0) throw new Error("Please select at least one covariate.");
  if (!data || data.length === 0) throw new Error("Dataset is empty or unavailable.");

  const dep = findActualVariable(variables, dependent);
  if (!dep) {
    throw new Error(`Dependent variable "${dependent.name}" was not found in the dataset. Please reselect it.`);
  }
  const covs = covariates.map((c) => {
    const found = findActualVariable(variables, c);
    if (!found) throw new Error(`Covariate "${c.name}" was not found in the dataset. Please reselect it.`);
    return found;
  });

  const rejected = covs.map(covariateRejectionReason).filter((r): r is string => r !== null);
  if (rejected.length > 0) throw new Error(rejected.join(" "));

  // Listwise deletion (sama dengan filter cleanData di worker produksi)
  const cols = [dep.columnIndex, ...covs.map((c) => c.columnIndex)];
  const cleanRows: DataRow[] = [];
  for (const row of data) {
    if (cols.every((ci) => !isMissing(row[ci]))) cleanRows.push(row);
  }
  if (cleanRows.length === 0) {
    throw new Error("No valid cases remaining after missing value handling.");
  }
  const n = cleanRows.length;

  // Kolom design matrix sesuai urutan kovariat: numerik → 1 kolom, kategorik → k-1 dummy.
  // Sekaligus kolom mentah tahap-1 (input analisis lengkap, seperti xMatrix worker produksi).
  const designColumns: Float64Array[] = [];
  const rawColumns: Float64Array[] = [];
  const featureNames: string[] = ["Constant"];
  const categoricalCodings: CategoricalCoding[] = [];
  const categoricalColumnIndices: number[] = [];
  const xEncodings: Record<string, Record<string, number>> = {};
  const invalid: { name: string; value: unknown; row: number }[] = [];
  covs.forEach((cov, covIdx) => {
    const raw = cleanRows.map((row) => row[cov.columnIndex] as string | number);
    if (isCategoricalCovariate(cov)) {
      const { columns, coding, rawCodes, encoding } = encodeCategorical(raw, cov.name);
      designColumns.push(...columns);
      featureNames.push(...coding.dummyNames);
      categoricalCodings.push(coding);
      rawColumns.push(rawCodes);
      categoricalColumnIndices.push(covIdx);
      xEncodings[cov.name] = encoding;
    } else {
      // Cabang non-kategorik processCovariates: Number(val), NaN ditolak
      const col = new Float64Array(n);
      raw.forEach((val, i) => {
        const num = Number(val);
        if (isNaN(num)) invalid.push({ name: cov.name, value: val, row: i });
        else col[i] = num;
      });
      designColumns.push(col);
      rawColumns.push(col);
      featureNames.push(cov.name);
    }
  });
  if (invalid.length > 0) {
    const names = [...new Set(invalid.map((v) => v.name))];
    const sample = invalid
      .slice(0, 5)
      .map((v) => `"${String(v.value)}" (row ${v.row + 1})`)
      .join(", ");
    const remaining = invalid.length - 5;
    throw new Error(
      `Variable(s) ${names.join(", ")} contain non-numeric value(s) that cannot be used as a scale covariate: ${sample}` +
        (remaining > 0 ? `, and ${remaining} more` : "") +
        `. If this variable is categorical, set its measurement level to Nominal/Ordinal.`
    );
  }

  // X row-major dengan intercept di kolom 0 (seperti insert_column(0, 1.0) di enter.rs)
  const p = designColumns.length + 1;
  const X = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const row = i * p;
    X[row] = 1;
    for (let j = 0; j < designColumns.length; j++) X[row + j + 1] = designColumns[j][i];
  }

  const rawY = cleanRows.map((row) => row[dep.columnIndex] as string | number);
  const { yVector, yMap } = encodeDependent(rawY);
  const y = Float64Array.from(yVector);

  const k = rawColumns.length;
  const xRaw = new Float64Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) xRaw[i * k + j] = rawColumns[j][i];
  const covariateNames = covs.map((c) => c.name);

  return {
    X,
    y,
    n,
    p,
    featureNames,
    yEncoding: yMap,
    nTotal: data.length,
    nMissing: data.length - n,
    dependent: dep,
    covariates: covs,
    categoricalCodings,
    full: {
      X: xRaw,
      y,
      rows: n,
      cols: k,
      configJson: buildProductionRustConfig(categoricalColumnIndices),
      featureNamesJson: JSON.stringify(covariateNames),
      modelInfo: {
        y_encoding: yMap,
        x_encodings: xEncodings,
        n_samples: n,
        n_missing: data.length - n,
        variables: covariateNames,
        include_constant: true,
      },
    },
  };
}

/** Ambil data dari useDataStore dan variabel dari useVariableStore (keadaan terkini). */
export function prepareFromStores(dependent: Variable | null, covariates: Variable[]): PreparedData {
  const { data } = useDataStore.getState();
  const { variables } = useVariableStore.getState();
  return prepareExperimentData(data, variables, dependent, covariates);
}

/**
 * Resampling baris dengan pengembalian ke ukuran targetN (mulberry32 ber-seed).
 * Jika targetN sama dengan n, data asli dipakai apa adanya (tanpa salinan).
 * Seed sama → dataset sama, sehingga keempat mode memakai data identik.
 */
export function resample(
  X: Float64Array,
  y: Float64Array,
  n: number,
  p: number,
  targetN: number,
  seed: number
): DatasetForRun {
  if (!Number.isInteger(targetN) || targetN < 1) {
    throw new Error(`Invalid target size N = ${targetN}.`);
  }
  if (targetN === n) return { X, y, n, p, resampled: false, sampling: "original" };

  const rng = mulberry32(seed);
  const Xr = new Float64Array(targetN * p);
  const yr = new Float64Array(targetN);
  for (let i = 0; i < targetN; i++) {
    const src = Math.floor(rng() * n);
    Xr.set(X.subarray(src * p, src * p + p), i * p);
    yr[i] = y[src];
  }
  return { X: Xr, y: yr, n: targetN, p, resampled: true, sampling: "resample" };
}

/**
 * N baris pertama tanpa pengembalian (sampling "prefix"). Dataset benchmark v2 sudah diacak
 * oleh skrip persiapan, jadi prefix adalah sampel acak sederhana. Hasilnya view (subarray) ke
 * data asli; runner tetap menyalin buffer (slice) sebelum timer. N = n → data asli apa adanya.
 */
export function takePrefix(X: Float64Array, y: Float64Array, n: number, p: number, targetN: number): DatasetForRun {
  if (!Number.isInteger(targetN) || targetN < 1) {
    throw new Error(`Invalid target size N = ${targetN}.`);
  }
  if (targetN > n) {
    throw new Error(
      `Prefix sampling takes the first N rows without replacement, so N must be ≤ ${n.toLocaleString("en-US")} ` +
        `(rows after listwise deletion); requested N = ${targetN.toLocaleString("en-US")}.`
    );
  }
  if (targetN === n) return { X, y, n, p, resampled: false, sampling: "original" };
  return { X: X.subarray(0, targetN * p), y: y.subarray(0, targetN), n: targetN, p, resampled: false, sampling: "prefix" };
}

/** Dataset workload "core" (design matrix) ukuran N sesuai sampling. */
export function sampleDataset(prepared: PreparedData, N: number, sampling: Sampling, dataSeed: number): DatasetForRun {
  return sampling === "prefix"
    ? takePrefix(prepared.X, prepared.y, prepared.n, prepared.p, N)
    : resample(prepared.X, prepared.y, prepared.n, prepared.p, N, dataSeed);
}

/** Input workload "full" ukuran N sesuai sampling; baris identik dengan sampleDataset. */
export function sampleFull(input: FullAnalysisInput, N: number, sampling: Sampling, dataSeed: number): FullAnalysisInput {
  return sampling === "prefix" ? prefixFull(input, N) : resampleFull(input, N, dataSeed);
}

/** Error yang jelas bila ada ukuran N yang tidak bisa dibentuk dengan sampling ini. */
export function checkSizes(sizes: number[], n: number, sampling: Sampling): void {
  if (sampling !== "prefix") return;
  const tooLarge = sizes.filter((N) => N > n);
  if (tooLarge.length > 0) {
    throw new Error(
      `Prefix sampling needs every N ≤ ${n.toLocaleString("en-US")} (rows after listwise deletion); ` +
        `too large: ${tooLarge.map((N) => N.toLocaleString("en-US")).join(", ")}. Use resampling or smaller sizes.`
    );
  }
}

/**
 * Resampling input analisis lengkap (kovariat mentah, kode kategori). Dengan
 * seed yang sama indeks barisnya identik dengan resample() pada design
 * matrix, jadi batch "core" dan "full" memproses baris yang sama untuk
 * (N, seed) yang sama. Data hasil resampling tidak punya missing.
 */
export function resampleFull(input: FullAnalysisInput, targetN: number, seed: number): FullAnalysisInput {
  const d = resample(input.X, input.y, input.rows, input.cols, targetN, seed);
  if (!d.resampled) return input;
  return {
    ...input,
    X: d.X,
    y: d.y,
    rows: d.n,
    modelInfo: { ...input.modelInfo, n_samples: d.n, n_missing: 0 },
  };
}

/**
 * N baris pertama input analisis lengkap (kovariat mentah), sama dengan takePrefix pada design
 * matrix, sehingga workload "core" dan "full" memproses baris yang sama persis. Seperti
 * resampleFull, subset tidak punya missing (n_missing = 0); N = n → input apa adanya.
 */
export function prefixFull(input: FullAnalysisInput, targetN: number): FullAnalysisInput {
  const d = takePrefix(input.X, input.y, input.rows, input.cols, targetN);
  if (d.sampling === "original") return input;
  return {
    ...input,
    X: d.X,
    y: d.y,
    rows: d.n,
    modelInfo: { ...input.modelInfo, n_samples: d.n, n_missing: 0 },
  };
}
