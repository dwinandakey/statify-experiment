/**
 * "Compare with production": menjalankan calculate_binary_logistic produksi
 * (metode Enter, opsi default dialog produksi) lewat worker produksi
 * /workers/Regression/binaryLogistic.worker.js pada data N asli, lalu
 * membandingkan B dan S.E. dengan hasil inti eksperimen.
 *
 * Worker produksi melakukan data prep-nya sendiri (listwise deletion,
 * encoding Y, kovariat) dari data mentah store, sama seperti dialog produksi.
 * Baris "Constant" di variables_in_equation dipetakan ke kolom intercept
 * (beta[0]); kovariat dicocokkan lewat nama.
 */
import type { Variable } from "@/types/Variable";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { CoreResult, ExperimentMode, PreparedData, ProductionComparison } from "../types/experiment";

export const PRODUCTION_WORKER_URL = "/workers/Regression/binaryLogistic.worker.js";
export const PRODUCTION_TOLERANCE = 1e-4;
const PRODUCTION_TIMEOUT_MS = 10 * 60_000;

export interface ProductionEnterResult {
  rows: { label: string; b: number; se: number }[];
  neg2ll: number | null;
  iterations: number | null;
  converged: boolean | null;
}

interface ProductionPayload {
  variables_in_equation?: { label: string; b: number; error: number }[];
  model_summary?: { log_likelihood?: number; iterations?: number; converged?: boolean };
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

  // Sama dengan analysisConfig BinaryLogisticMain.tsx dengan opsi default
  // (DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS) dan metode Enter.
  const analysisConfig = {
    dependent_index: variables.findIndex((v) => v.id === dep.id),
    independent_indices: covs.map((c) => variables.findIndex((v) => v.id === c.id)),
    max_iterations: 20,
    include_constant: true,
    convergence_threshold: 0.001,
    confidence_level: 95,
    cutoff: 0.5,
    method: "Enter",
    p_entry: 0.05,
    p_removal: 0.1,
    classification_plots: false,
    hosmer_lemeshow: false,
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
    rows: data.length,
    cols: variables.length,
    categoricalVariables: [],
    assumptions: { multicollinearity: false, box_tidwell: false },
  };

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
      const p = payload as ProductionPayload;
      const rows = (p.variables_in_equation ?? []).map((r) => ({ label: r.label, b: r.b, se: r.error }));
      const ll = p.model_summary?.log_likelihood;
      resolve({
        rows,
        neg2ll: typeof ll === "number" ? -2 * ll : null,
        iterations: p.model_summary?.iterations ?? null,
        converged: p.model_summary?.converged ?? null,
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
  production: ProductionEnterResult,
  experiment: CoreResult,
  featureNames: string[],
  mode: ExperimentMode,
  n: number,
  tolerance = PRODUCTION_TOLERANCE
): ProductionComparison {
  const used = new Set<number>();
  const rows = featureNames.map((name, j) => {
    let idx = production.rows.findIndex((r, i) => !used.has(i) && r.label === name);
    if (idx < 0) idx = j < production.rows.length && !used.has(j) ? j : -1; // cadangan: posisi
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
