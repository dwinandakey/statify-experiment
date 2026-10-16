/**
 * Jalur produksi Binary Logistic: menjalankan calculate_binary_logistic
 * (metode Enter, opsi default dialog produksi) lewat worker produksi
 * /workers/Regression/binaryLogistic.worker.js pada data N asli.
 *
 * Dipakai untuk dua hal:
 * - "Compare with production": B dan S.E. produksi dibandingkan dengan hasil
 *   inti eksperimen (baris "Constant" ↔ kolom intercept, kolom lain lewat nama,
 *   termasuk dummy `nama(j)`; baris grup kategorik tanpa B dilewati);
 * - tombol OK: payload lengkapnya diformat dengan formatter produksi
 *   sehingga output viewer identik dengan modul Binary Logistic asli.
 *
 * Worker produksi melakukan data prep-nya sendiri (listwise deletion,
 * encoding Y, kovariat, dummy coding) dari data mentah store, sama seperti
 * dialog produksi.
 */
import type { Variable } from "@/types/Variable";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { LogisticResult } from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import { DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS as DEFAULT_OPTIONS } from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import type { CoreResult, ExperimentMode, PreparedData, ProductionComparison } from "../types/experiment";
import { isCategoricalCovariate } from "./prepareData";

export const PRODUCTION_WORKER_URL = "/workers/Regression/binaryLogistic.worker.js";
export const PRODUCTION_TOLERANCE = 1e-4;
const PRODUCTION_TIMEOUT_MS = 10 * 60_000;

export interface ProductionEnterResult {
  rows: { label: string; b: number; se: number }[];
  neg2ll: number | null;
  iterations: number | null;
  converged: boolean | null;
  /** Payload lengkap worker produksi (LogisticResult + model_info) untuk formatter. */
  payload: LogisticResult;
}

/**
 * analysisConfig sama dengan BinaryLogisticMain.tsx produksi pada metode
 * Enter dengan opsi default (DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS).
 * Kovariat nominal/ordinal masuk categoricalVariables dengan Indicator/Last,
 * persis seperti yang ditambahkan dialog produksi secara otomatis.
 */
function buildAnalysisConfig(prepared: PreparedData, variables: Variable[], rows: number) {
  const o = DEFAULT_OPTIONS;
  return {
    dependent_index: variables.findIndex((v) => v.id === prepared.dependent.id),
    independent_indices: prepared.covariates.map((c) => variables.findIndex((v) => v.id === c.id)),
    max_iterations: o.maxIterations,
    include_constant: o.includeConstant,
    convergence_threshold: 0.001,
    confidence_level: o.ciLevel,
    cutoff: o.classificationCutoff,
    method: "Enter",
    p_entry: o.probEntry,
    p_removal: o.probRemoval,
    classification_plots: o.classificationPlots,
    hosmer_lemeshow: o.hosmerLemeshow,
    casewise_listing: o.casewiseListing,
    casewise_type: o.casewiseType,
    casewise_outliers: o.casewiseOutliers,
    iteration_history: o.iterationHistory,
    correlations: o.correlations,
    display_at_last_step: !o.displayAtEachStep,
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
    rows,
    cols: variables.length,
    categoricalVariables: prepared.covariates
      .filter(isCategoricalCovariate)
      .map((c) => ({ id: c.id, method: "Indicator", reference: "Last" })),
    assumptions: { multicollinearity: false, box_tidwell: false },
  };
}

export function runProductionEnter(prepared: PreparedData): Promise<ProductionEnterResult> {
  const variables = useVariableStore.getState().variables;
  const { data } = useDataStore.getState();
  const dep = prepared.dependent;
  const covs = prepared.covariates;
  if (dep.id === undefined || covs.some((c) => c.id === undefined)) {
    return Promise.reject(new Error("Selected variables have no id; reload the dataset and try again."));
  }

  const variableDetails: Record<number, Variable> = {};
  variables.forEach((v) => {
    if (v.id !== undefined) variableDetails[v.id] = v;
  });
  const analysisConfig = buildAnalysisConfig(prepared, variables, data.length);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(PRODUCTION_WORKER_URL, window.location.origin), { type: "module" });
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("Production worker timed out."));
    }, PRODUCTION_TIMEOUT_MS);

    worker.onmessage = (event) => {
      const { type, payload } = event.data ?? {};
      done();
      if (type !== "SUCCESS") {
        reject(new Error(typeof payload === "string" ? payload : "Production worker failed."));
        return;
      }
      const result = payload as LogisticResult;
      const rows = (result.variables_in_equation ?? []).map((r) => ({ label: r.label, b: r.b, se: r.error }));
      const ll = result.model_summary?.log_likelihood;
      resolve({
        rows,
        neg2ll: typeof ll === "number" ? -2 * ll : null,
        iterations: result.model_summary?.iterations ?? null,
        converged: result.model_summary?.converged ?? null,
        payload: result,
      });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      done();
      reject(new Error(`Production worker error: ${event.message || "unknown error"}`));
    };

    worker.postMessage({
      action: "run_binary_logistic",
      dependentId: dep.id,
      independentIds: covs.map((c) => c.id),
      data,
      variableDetails,
      config: JSON.stringify(analysisConfig),
    });
  });
}

/** Cocokkan baris produksi dengan koefisien eksperimen (Constant ↔ intercept, sisanya lewat nama). */
export function compareWithProduction(
  production: Pick<ProductionEnterResult, "rows" | "neg2ll" | "iterations" | "converged">,
  experiment: CoreResult,
  featureNames: string[],
  mode: ExperimentMode,
  n: number,
  tolerance = PRODUCTION_TOLERANCE
): ProductionComparison {
  const used = new Set<number>();
  const rows = featureNames.map((name, j) => {
    // Tanpa cadangan posisi: baris grup kategorik (tanpa B) menggeser urutan produksi
    const idx = production.rows.findIndex((r, i) => !used.has(i) && r.label === name);
    if (idx < 0) throw new Error(`Production output has no row for "${name}".`);
    used.add(idx);
    const prod = production.rows[idx];
    return {
      label: name,
      bProduction: prod.b,
      bExperiment: experiment.beta[j],
      seProduction: prod.se,
      seExperiment: experiment.se[j],
      absDiffB: Math.abs(prod.b - experiment.beta[j]),
      absDiffSe: Math.abs(prod.se - experiment.se[j]),
    };
  });
  const maxAbsDiffB = Math.max(...rows.map((r) => r.absDiffB));
  const maxAbsDiffSe = Math.max(...rows.map((r) => r.absDiffSe));
  return {
    mode,
    n,
    rows,
    maxAbsDiffB,
    maxAbsDiffSe,
    neg2llProduction: production.neg2ll,
    neg2llExperiment: experiment.neg2ll,
    iterationsProduction: production.iterations,
    iterationsExperiment: experiment.iterations,
    passed: maxAbsDiffB < tolerance && maxAbsDiffSe < tolerance,
    tolerance,
  };
}
