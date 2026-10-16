/**
 * Tombol OK: tulis hasil ke output viewer.
 *
 * 1. Laporan statistik berkonvensi SPSS yang IDENTIK dengan modul Binary
 *    Logistic produksi (metode Enter, semua opsi default): payload dari worker
 *    produksi (calculate_binary_logistic), formatter produksi
 *    `formatBinaryLogisticResult`, sintaks dari `generateLogisticRegressionSyntax`,
 *    dan pengelompokan komponen yang sama dengan handleAnalyze di
 *    BinaryLogisticMain.tsx. Inti eksperimen sengaja hanya menghitung B, S.E.,
 *    dan -2LL (agar perbandingan waktunya adil), sedangkan tabel SPSS butuh
 *    Block 0, score test, classification table, dst.; kesamaan koefisiennya
 *    dengan produksi ditunjukkan di kartu eksperimen.
 * 2. Kartu terpisah "Binary Logistic (Experiment)" di bawah log yang sama:
 *    ringkasan Run once, batch, akurasi antar mode, dan perbandingan produksi.
 *    Data mentah per run tetap lewat Download CSV.
 */
import { useResultStore } from "@/stores/useResultStore";
import { formatBinaryLogisticResult } from "@/components/Modals/Analyze/Regression/BinaryLogistic/services/formatter";
import { generateLogisticRegressionSyntax } from "@/components/Modals/Analyze/Regression/BinaryLogistic/services/syntaxGenerator";
import {
  DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS as DEFAULT_OPTIONS,
  DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS,
  type AnalysisSection,
  type BinaryLogisticCategoricalParams,
} from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import type { ExperimentResults, PreparedData } from "../types/experiment";
import { MODES } from "../types/experiment";
import { isCategoricalCovariate } from "./prepareData";
import { runProductionEnter } from "./productionCompare";
import { fmtDiff, fmtInt, fmtMs, fmtNum } from "./format";

const METHOD = "Enter" as const;
export const EXPERIMENT_ANALYTIC_TITLE = "Binary Logistic (Experiment): 2×2 performance";

/** Pengelompokan komponen per section, disalin dari handleAnalyze BinaryLogisticMain.tsx. */
function productionComponentCategory(section: AnalysisSection): string {
  const cleanTitle = section.title.replace(/<[^>]*>?/gm, " ").trim();
  if (section.id.includes("fitting_warnings")) return "Warnings";
  if (section.id.includes("case_processing")) return "Case Summary";
  if (section.id.includes("encoding")) return "Dependent Variable Encoding";
  if (section.id.includes("categorical_codings")) return "Categorical Variables Codings";
  if (section.id.includes("block0")) return "Block 0: Beginning Block";
  if (section.id.includes("block1") || section.id.includes("hosmer") || section.id.startsWith("classification_plot")) {
    return `Block 1: Method = ${METHOD}`;
  }
  if (section.id.includes("casewise")) return "Casewise Diagnostics";
  if (section.id.startsWith("assumption_")) return "Assumption Tests";
  return cleanTitle;
}

/** Payload renderer, sama dengan BinaryLogisticMain.tsx (chart vs tabel). */
function rendererPayload(section: AnalysisSection) {
  if (section.type === "chart" && section.chartData) {
    return { charts: section.chartData.charts, description: section.description, title: section.title };
  }
  return { tables: [{ ...section.data, title: section.title }] };
}

/** Parameter kategorik setara state dialog produksi setelah deteksi otomatis nominal/ordinal. */
export function defaultCategoricalParams(prepared: PreparedData): BinaryLogisticCategoricalParams {
  const cats = prepared.covariates.filter(isCategoricalCovariate);
  return {
    covariates: cats.map((v) => v.name),
    variableSettings: Object.fromEntries(
      cats.map((v) => [v.name, { name: v.name, contrast: "Indicator" as const, referenceCategory: "Last" as const }])
    ),
  };
}

// --- Tabel kartu eksperimen ---

interface TableSpec {
  title: string;
  columnHeaders: { header: string; key: string }[];
  rows: Record<string, unknown>[];
}

function table(title: string, columns: [string, string][], rows: Record<string, string>[]): TableSpec {
  return {
    title,
    columnHeaders: columns.map(([header, key]) => ({ header, key })),
    rows: rows.map((r) => ({ rowHeader: [], ...r })),
  };
}

interface ExperimentSection {
  title: string;
  description: string;
  component: string;
  spec: TableSpec;
}

export function buildExperimentSections(results: ExperimentResults): ExperimentSection[] {
  const sections: ExperimentSection[] = [];

  if (results.single) {
    const { record, featureNames } = results.single;
    const r = record.result;
    if (r) {
      sections.push({
        title: `Coefficients – Run once (${MODES[record.mode].label})`,
        description: `N = ${fmtInt(record.N)}, iterations = ${r.iterations}, converged = ${r.converged}, -2LL = ${fmtNum(r.neg2ll, 4)}.`,
        component: "Experiment: Run once",
        spec: table(
          "Coefficients (Run once)",
          [["Variable", "label"], ["B", "b"], ["S.E.", "se"], ["Exp(B)", "expb"]],
          featureNames.map((name, j) => ({
            label: name,
            b: fmtNum(r.beta[j], 6),
            se: fmtNum(r.se[j], 6),
            expb: fmtNum(Math.exp(r.beta[j]), 6),
          }))
        ),
      });
    }
    sections.push({
      title: "Timing – Run once",
      description: `Mode ${record.mode}${record.workerStart ? ` (${record.workerStart} worker)` : ""}, N = ${fmtInt(record.N)}.`,
      component: "Experiment: Run once",
      spec: table(
        "Timing (Run once)",
        [["Metric", "metric"], ["Value", "value"]],
        [
          ["computeMs", fmtMs(record.computeMs, 3)],
          ["e2eMs", fmtMs(record.e2eMs, 3)],
          ["overheadMs", fmtMs(record.overheadMs, 3)],
          ["wasmCoreMs", fmtMs(record.result?.wasmCoreMs, 3)],
          ["spawnMs", fmtMs(record.spawnMs, 3)],
          ["initMs", fmtMs(record.initMs, 3)],
          ["maxFrameGapMs", fmtMs(record.maxFrameGapMs, 1)],
          ["droppedFrames", fmtInt(record.droppedFrames)],
          ["longTaskCount", fmtInt(record.longTaskCount)],
          ["longTaskTotalMs", fmtMs(record.longTaskTotalMs, 1)],
        ].map(([metric, value]) => ({ metric, value }))
      ),
    });
  }

  if (results.batch) {
    const { summaries, accuracy, outcome } = results.batch;
    const s = outcome.meta.settings;
    sections.push({
      title: "Batch benchmark – summary",
      description:
        `Batch ${outcome.meta.batchId} (${outcome.meta.status}): ${outcome.records.length} recorded runs, ` +
        `warm-up ${s.warmup}, repetitions ${s.repetitions}, seed ${s.seed}, ${s.coldWorkers ? "cold" : "warm"} workers, ` +
        `build ${outcome.meta.environment.buildMode}. Values in ms: median [Q1–Q3]. Per-run data: Download CSV in the dialog.`,
      component: "Experiment: Batch benchmark",
      spec: table(
        "Batch summary (ms)",
        [["N", "n"], ["Mode", "mode"], ["Runs", "runs"], ["computeMs", "compute"], ["e2eMs", "e2e"], ["maxFrameGapMs", "gap"]],
        summaries.map((sm) => {
          const cell = (st: typeof sm.e2eMs) => (st ? `${fmtMs(st.median)} [${fmtMs(st.q1)}–${fmtMs(st.q3)}]` : "–");
          return {
            n: fmtInt(sm.N),
            mode: MODES[sm.mode].label,
            runs: `${sm.runs}${sm.errors ? ` (${sm.errors} errors)` : ""}`,
            compute: cell(sm.computeMs),
            e2e: cell(sm.e2eMs),
            gap: cell(sm.maxFrameGapMs),
          };
        })
      ),
    });
    sections.push({
      title: "Batch benchmark – accuracy vs mode D",
      description: "Maximum absolute difference of B and S.E. against the first run of mode D at the same N, over all runs.",
      component: "Experiment: Batch benchmark",
      spec: table(
        "Accuracy vs mode D",
        [["N", "n"], ["Mode", "mode"], ["max |ΔB|", "db"], ["max |ΔS.E.|", "dse"], ["Iterations", "it"]],
        accuracy.map((a) => ({
          n: fmtInt(a.N),
          mode: MODES[a.mode].label,
          db: fmtDiff(a.maxAbsDiffBeta),
          dse: fmtDiff(a.maxAbsDiffSe),
          it: fmtInt(a.iterations),
        }))
      ),
    });
  }

  if (results.comparison && results.comparison.comparisons.length > 0) {
    const comps = results.comparison.comparisons;
    sections.push({
      title: "Experiment vs production (Enter)",
      description:
        `N = ${fmtInt(comps[0].n)}. Maximum absolute difference between each mode's B and S.E. and the production ` +
        `calculate_binary_logistic result; tolerance ${comps[0].tolerance}.`,
      component: "Experiment: Production comparison",
      spec: table(
        "Experiment vs production",
        [["Mode", "mode"], ["max |ΔB|", "db"], ["max |ΔS.E.|", "dse"], ["-2LL (experiment)", "ll"], ["Iterations", "it"], ["Result", "ok"]],
        comps.map((c) => ({
          mode: MODES[c.mode].label,
          db: fmtDiff(c.maxAbsDiffB),
          dse: fmtDiff(c.maxAbsDiffSe),
          ll: fmtNum(c.neg2llExperiment, 4),
          it: fmtInt(c.iterationsExperiment),
          ok: c.passed ? "PASS" : "FAIL",
        }))
      ),
    });
  }
  return sections;
}

/**
 * Jalankan Enter produksi pada data terpilih lalu tulis laporan SPSS +
 * kartu eksperimen. Mengembalikan jumlah statistik yang ditulis.
 */
export async function writeExperimentOutput(
  prepared: PreparedData,
  results: ExperimentResults
): Promise<{ statisticalSections: number; experimentSections: number }> {
  const production = await runProductionEnter(prepared);
  const formatted = formatBinaryLogisticResult(production.payload, prepared.dependent, prepared.covariates, {
    displayAtLastStep: !DEFAULT_OPTIONS.displayAtEachStep,
    ciForExpB: DEFAULT_OPTIONS.ciForExpB,
    ciLevel: DEFAULT_OPTIONS.ciLevel,
    cutoff: DEFAULT_OPTIONS.classificationCutoff,
    casewiseOutliers: DEFAULT_OPTIONS.casewiseOutliers,
  });
  const syntax = generateLogisticRegressionSyntax({
    dependent: prepared.dependent,
    covariates: prepared.covariates,
    factors: [],
    method: METHOD,
    categoricalParams: defaultCategoricalParams(prepared),
    saveParams: DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS,
    optionParams: DEFAULT_OPTIONS,
  });

  const { addLog, addAnalytic, addStatistic } = useResultStore.getState();
  const logId = await addLog({ log: syntax });

  const analyticId = await addAnalytic(logId, { title: "Binary Logistic Regression", note: `Method: ${METHOD}` });
  const statSections = formatted.sections ?? [];
  for (const section of statSections) {
    await addStatistic(analyticId, {
      title: section.title,
      description: section.description || "",
      output_data: JSON.stringify(rendererPayload(section)),
      components: productionComponentCategory(section),
    });
  }

  const experimentSections = buildExperimentSections(results);
  if (experimentSections.length > 0) {
    const expId = await addAnalytic(logId, {
      title: EXPERIMENT_ANALYTIC_TITLE,
      note:
        "JavaScript vs Rust-Wasm × main thread vs Web Worker (IRLS core only). The statistical tables above come from the " +
        "production pipeline; this card summarises the benchmark and the agreement of the experiment cores with it.",
    });
    for (const s of experimentSections) {
      await addStatistic(expId, {
        title: s.title,
        description: s.description,
        output_data: JSON.stringify({ tables: [s.spec] }),
        components: s.component,
      });
    }
  }
  return { statisticalSections: statSections.length, experimentSections: experimentSections.length };
}
