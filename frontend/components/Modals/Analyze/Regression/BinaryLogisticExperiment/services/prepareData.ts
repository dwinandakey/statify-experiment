/**
 * Persiapan data bersama untuk keempat mode eksperimen. Dijalankan SEKALI di
 * main thread, di luar jendela pengukuran waktu.
 *
 * Aturan listwise deletion, validasi kovariat, dan encoding Y disalin dari
 * worker produksi public/workers/Regression/binaryLogistic.worker.js
 * (filter `cleanData`, `processCovariates` cabang non-kategorik, dan
 * `processDependentVariable`) supaya hasilnya sebanding dengan Enter produksi.
 */
import type { DataRow } from "@/types/Data";
import type { Variable } from "@/types/Variable";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { DatasetForRun, PreparedData } from "../types/experiment";
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

/** Kovariat kategorik/string ditolak karena eksperimen ini tidak punya tab Categorical. */
export function covariateRejectionReason(v: Variable): string | null {
  const measure = v.measure?.toLowerCase();
  if (v.type === "STRING") {
    return `Covariate "${v.name}" is a string variable.`;
  }
  // Produksi otomatis memperlakukan nominal/ordinal sebagai kategorik (dummy coding).
  if (measure === "nominal" || measure === "ordinal") {
    return `Covariate "${v.name}" has measurement level ${measure}; production would dummy-code it as categorical.`;
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
  if (rejected.length > 0) {
    throw new Error(
      `${rejected.join(" ")} This experiment accepts numeric (scale) covariates only because it has no Categorical tab. ` +
        `Change the measurement level to Scale if the variable is truly numeric, or remove it.`
    );
  }

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
  const k = covs.length;
  const p = k + 1;

  // Kovariat numerik: Number(val), nilai NaN ditolak (cabang non-kategorik processCovariates)
  const X = new Float64Array(n * p);
  const invalid: { name: string; value: unknown; row: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = cleanRows[i];
    X[i * p] = 1;
    for (let j = 0; j < k; j++) {
      const raw = row[covs[j].columnIndex];
      const num = Number(raw);
      if (isNaN(num)) {
        invalid.push({ name: covs[j].name, value: raw, row: i });
        X[i * p + j + 1] = 0;
      } else {
        X[i * p + j + 1] = num;
      }
    }
  }
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
        "."
    );
  }

  const rawY = cleanRows.map((row) => row[dep.columnIndex] as string | number);
  const { yVector, yMap } = encodeDependent(rawY);
  const y = Float64Array.from(yVector);

  return {
    X,
    y,
    n,
    p,
    featureNames: ["Constant", ...covs.map((c) => c.name)],
    yEncoding: yMap,
    nTotal: data.length,
    nMissing: data.length - n,
    dependent: dep,
    covariates: covs,
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
  if (targetN === n) return { X, y, n, p, resampled: false };

  const rng = mulberry32(seed);
  const Xr = new Float64Array(targetN * p);
  const yr = new Float64Array(targetN);
  for (let i = 0; i < targetN; i++) {
    const src = Math.floor(rng() * n);
    Xr.set(X.subarray(src * p, src * p + p), i * p);
    yr[i] = y[src];
  }
  return { X: Xr, y: yr, n: targetN, p, resampled: true };
}
