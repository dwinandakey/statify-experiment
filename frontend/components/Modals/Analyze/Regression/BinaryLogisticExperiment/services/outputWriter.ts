/**
 * Tombol OK: jalankan analisis Binary Logistic lengkap (metode Enter, semua
 * opsi default) pada konfigurasi A/B/C/D yang dipilih, lalu tulis ke output viewer.
 *
 * 1. Laporan statistik berkonvensi SPSS (bisa dimatikan): tabel yang sudah
 *    diformat ExperimentSession.runFull dengan formatter produksi
 *    `formatBinaryLogisticResult` (lihat spssFormat.ts), sintaks dari
 *    `generateLogisticRegressionSyntax`, dan pengelompokan komponen yang sama
 *    dengan handleAnalyze di BinaryLogisticMain.tsx. Catatan kartu menyebut
 *    konfigurasi yang menghitungnya.
 * 2. Kartu "Binary Logistic (Experiment)" di bawah log yang sama: performa
 *    run OK tersebut, lalu ringkasan Run once, batch inti IRLS, batch analisis
 *    lengkap, dan perbandingan produksi. Tabel SPSS dari run batch tidak
 *    ditulis (hanya divalidasi lewat hash); data mentah per run lewat Download CSV.
 */
import { useResultStore } from "@/stores/useResultStore";
import { generateLogisticRegressionSyntax } from "@/components/Modals/Analyze/Regression/BinaryLogistic/services/syntaxGenerator";
import {
  DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS as DEFAULT_OPTIONS,
  DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS,
  type AnalysisSection,
  type BinaryLogisticCategoricalParams,
} from "@/components/Modals/Analyze/Regression/BinaryLogistic/types/binary-logistic";
import type { BatchResult, ExperimentResults, FullRunRecord, PreparedData, Workload } from "../types/experiment";
import { MODES } from "../types/experiment";
import { isCategoricalCovariate } from "./prepareData";
import { METHOD } from "./spssFormat";
import { fmtDiff, fmtInt, fmtMB, fmtMs, fmtNum } from "./format";

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

const BATCH_TEXT: Record<Workload, { name: string; component: string }> = {
  core: { name: "IRLS core", component: "Experiment: Batch benchmark (IRLS core)" },
  full: { name: "full analysis + SPSS tables", component: "Experiment: Batch benchmark (full analysis)" },
};

function batchSections(workload: Workload, result: BatchResult): ExperimentSection[] {
  const { summaries, accuracy, outcome } = result;
  const { meta } = outcome;
  const s = meta.settings;
  const text = BATCH_TEXT[workload];
  const full = workload === "full";
  const cell = (st: (typeof summaries)[number]["e2eMs"]) => (st ? `${fmtMs(st.median)} [${fmtMs(st.q1)}–${fmtMs(st.q3)}]` : "–");

  const summaryColumns: [string, string][] = [["N", "n"], ["Mode", "mode"], ["Runs", "runs"], ["computeMs", "compute"], ["e2eMs", "e2e"]];
  if (full) summaryColumns.push(["formatMs", "format"], ["totalMs", "total"]);
  summaryColumns.push(["maxFrameGapMs", "gap"]);

  const accuracyColumns: [string, string][] = [["N", "n"], ["Mode", "mode"], ["max |ΔB|", "db"], ["max |ΔS.E.|", "dse"], ["Iterations", "it"]];
  if (full) accuracyColumns.push(["SPSS tables identical to D", "tables"]);

  return [
    {
      title: `Batch benchmark (${text.name}) – summary`,
      description:
        `Batch ${meta.batchId} (${meta.status}): ${outcome.records.length} recorded runs of ${meta.dataset.dependent} ~ ` +
        `${meta.dataset.covariates.join(", ")}; warm-up ${s.warmup}, repetitions ${s.repetitions}, seed ${s.seed}, ` +
        `${s.coldWorkers ? "cold" : "warm"} workers, build ${meta.environment.buildMode}. ` +
        (full
          ? "Each run computed the full analysis and built the SPSS tables (not written); totalMs = dispatch → tables formatted. "
          : "") +
        "Values in ms: median [Q1–Q3]. Per-run data: Download CSV in the dialog.",
      component: text.component,
      spec: table(
        `Batch summary – ${text.name} (ms)`,
        summaryColumns,
        summaries.map((sm) => ({
          n: fmtInt(sm.N),
          mode: MODES[sm.mode].label,
          runs: `${sm.runs}${sm.errors ? ` (${sm.errors} errors)` : ""}`,
          compute: cell(sm.computeMs),
          e2e: cell(sm.e2eMs),
          format: cell(sm.formatMs),
          total: cell(sm.totalMs),
          gap: cell(sm.maxFrameGapMs),
        }))
      ),
    },
    {
      title: `Batch benchmark (${text.name}) – accuracy vs mode D`,
      description: full
        ? "Maximum absolute difference of B and S.E. (Variables in the Equation) against the first run of mode D at the same N, and the number of runs whose formatted SPSS tables are identical to that run."
        : "Maximum absolute difference of B and S.E. against the first run of mode D at the same N, over all runs.",
      component: text.component,
      spec: table(
        `Accuracy vs mode D – ${text.name}`,
        accuracyColumns,
        accuracy.map((a) => ({
          n: fmtInt(a.N),
          mode: MODES[a.mode].label,
          db: fmtDiff(a.maxAbsDiffBeta),
          dse: fmtDiff(a.maxAbsDiffSe),
          it: fmtInt(a.iterations),
          tables: a.tablesIdentical ? `${a.tablesIdentical.identical}/${a.tablesIdentical.total}` : "–",
        }))
      ),
    },
  ];
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

  for (const workload of ["core", "full"] as const) {
    const batch = results.batches[workload];
    if (batch) sections.push(...batchSections(workload, batch));
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

const ENGINE_LABEL: Record<"js" | "wasm", string> = {
  js: "JavaScript port logistic_enter.js",
  wasm: "Rust calculate_binary_logistic (WebAssembly)",
};

/** Tabel performa analisis lengkap yang dijalankan tombol OK. */
function okRunSection(run: FullRunRecord, saveMs: number | null): ExperimentSection {
  const info = MODES[run.mode];
  const rows: [string, string, string][] = [
    ["computeMs", fmtMs(run.computeMs, 3), "full analysis, measured where it runs"],
    ["e2eMs", fmtMs(run.e2eMs, 3), "main thread: dispatch → result available"],
    ["overheadMs", fmtMs(run.overheadMs, 3), "e2eMs − computeMs"],
    ["formatMs", fmtMs(run.formatMs, 3), "production SPSS formatter on the main thread"],
    ["totalMs", fmtMs(run.totalMs, 3), "dispatch → SPSS tables formatted"],
    ["engineInitMs", fmtMs(run.engineInitMs, 3), "engine load before timing (0 if already loaded)"],
  ];
  if (run.workerCreated) {
    rows.push(["spawnMs", fmtMs(run.spawnMs, 3), `new ${run.workerStart ?? ""} worker, before timing`]);
    rows.push(["initMs", fmtMs(run.initMs, 3), "worker init, before timing"]);
  }
  rows.push(
    ["maxFrameGapMs", fmtMs(run.maxFrameGapMs, 1), `${fmtInt(run.frameCount)} frames observed`],
    ["droppedFrames", fmtInt(run.droppedFrames), "rAF gaps > 2 × 16.7 ms"],
    [
      "longTasks",
      run.longTaskCount === null ? "n/a" : `${run.longTaskCount} · ${fmtMs(run.longTaskTotalMs, 1)} ms`,
      "count · total",
    ],
    ["heapUsedMB", fmtMB(run.heapUsedMB), "main-thread JS heap (Chromium)"],
    ["wasmMemoryMB", fmtMB(run.wasmMemoryMB), "wasm linear memory"]
  );
  if (saveMs !== null) rows.push(["saveMs", fmtMs(saveMs, 3), "writing the SPSS tables to the output store"]);
  return {
    title: `Analysis run (OK) – ${info.label}`,
    description:
      `Full Binary Logistic analysis (Enter, default options) computed by ${ENGINE_LABEL[info.technology]} on the ` +
      `${info.location === "main" ? "main thread" : "Web Worker"}, then formatted into SPSS tables on the main thread; ` +
      `N = ${fmtInt(run.rows)}, covariates = ${run.cols}. One run without warm-up` +
      `${run.pageHidden ? "; the tab was hidden during the run, frame metrics are invalid" : ""}.`,
    component: "Experiment: Analysis run (OK)",
    spec: table(
      `Analysis run performance – ${info.label}`,
      [["Metric", "metric"], ["Value", "value"], ["Notes", "notes"]],
      rows.map(([metric, value, notes]) => ({ metric, value, notes }))
    ),
  };
}

export interface WriteOptions {
  /** Tulis juga tabel SPSS (false: hanya laporan performa). */
  includeSpss: boolean;
}

/**
 * Tulis hasil run OK (`okRun`, dari ExperimentSession.runFull): log sintaks,
 * tabel SPSS (opsional), lalu kartu eksperimen.
 */
export async function writeExperimentOutput(
  prepared: PreparedData,
  results: ExperimentResults,
  okRun: FullRunRecord,
  options: WriteOptions
): Promise<{ logId: number; statisticalSections: number; experimentSections: number }> {
  if (okRun.error || !okRun.formatted) throw new Error(okRun.error ?? "Analysis produced no result.");
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
  const label = MODES[okRun.mode].label;

  let statSections: AnalysisSection[] = [];
  let saveMs: number | null = null;
  if (options.includeSpss) {
    const tSave = performance.now();
    const analyticId = await addAnalytic(logId, {
      title: "Binary Logistic Regression",
      note: `Method: ${METHOD} · computed with ${label}`,
    });
    statSections = okRun.formatted.sections ?? [];
    for (const section of statSections) {
      await addStatistic(analyticId, {
        title: section.title,
        description: section.description || "",
        output_data: JSON.stringify(rendererPayload(section)),
        components: productionComponentCategory(section),
      });
    }
    saveMs = performance.now() - tSave;
  }

  const coreSections = buildExperimentSections(results);
  const experimentSections = [okRunSection(okRun, saveMs), ...coreSections];
  const expId = await addAnalytic(logId, {
    title: EXPERIMENT_ANALYTIC_TITLE,
    note:
      "JavaScript vs Rust-Wasm × main thread vs Web Worker. " +
      (options.includeSpss
        ? `The statistical tables above were computed with ${label}`
        : `Analysis computed with ${label}; SPSS tables were not written (performance report only)`) +
      (coreSections.length > 0 ? ". Run once and batch results below were measured in the dialog." : "."),
  });
  for (const s of experimentSections) {
    await addStatistic(expId, {
      title: s.title,
      description: s.description,
      output_data: JSON.stringify({ tables: [s.spec] }),
      components: s.component,
    });
  }
  return { logId, statisticalSections: statSections.length, experimentSections: experimentSections.length };
}
