/**
 * Tombol OK: tulis ringkasan hasil terakhir ke output viewer lewat
 * addLog / addAnalytic / addStatistic, dengan format tabel yang sama seperti
 * BinaryLogisticMain.tsx produksi ({ tables: [{ title, columnHeaders, rows }] }).
 */
import { useResultStore } from "@/stores/useResultStore";
import type { ExperimentResults } from "../types/experiment";
import { MODES } from "../types/experiment";
import { fmtDiff, fmtInt, fmtMs, fmtNum } from "./format";

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

/** Kembalikan jumlah tabel yang ditulis (0 bila belum ada hasil). */
export async function writeExperimentOutput(results: ExperimentResults): Promise<number> {
  const sections: { title: string; description: string; spec: TableSpec; component: string }[] = [];

  if (results.single) {
    const { record, featureNames } = results.single;
    const r = record.result;
    if (r) {
      sections.push({
        title: `Coefficients – Run once (${MODES[record.mode].label})`,
        description: `N = ${fmtInt(record.N)}, iterations = ${r.iterations}, converged = ${r.converged}, -2LL = ${fmtNum(r.neg2ll, 4)}.`,
        component: "Run once",
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
      description: `Mode ${record.mode}${record.workerStart ? ` (${record.workerStart} worker)` : ""}.`,
      component: "Run once",
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
    sections.push({
      title: "Batch benchmark – summary",
      description:
        `Batch ${outcome.meta.batchId} (${outcome.meta.status}): ${outcome.records.length} recorded runs, ` +
        `warm-up ${outcome.meta.settings.warmup}, repetitions ${outcome.meta.settings.repetitions}, seed ${outcome.meta.settings.seed}, ` +
        `${outcome.meta.settings.coldWorkers ? "cold" : "warm"} workers. Values in ms: median [Q1–Q3].`,
      component: "Batch benchmark",
      spec: table(
        "Batch summary (ms)",
        [["N", "n"], ["Mode", "mode"], ["Runs", "runs"], ["computeMs", "compute"], ["e2eMs", "e2e"], ["maxFrameGapMs", "gap"]],
        summaries.map((s) => {
          const cell = (st: typeof s.e2eMs) => (st ? `${fmtMs(st.median)} [${fmtMs(st.q1)}–${fmtMs(st.q3)}]` : "–");
          return {
            n: fmtInt(s.N),
            mode: MODES[s.mode].label,
            runs: `${s.runs}${s.errors ? ` (${s.errors} errors)` : ""}`,
            compute: cell(s.computeMs),
            e2e: cell(s.e2eMs),
            gap: cell(s.maxFrameGapMs),
          };
        })
      ),
    });
    sections.push({
      title: "Batch benchmark – accuracy vs mode D",
      description: "Maximum absolute difference of B and S.E. against the first run of mode D at the same N.",
      component: "Batch benchmark",
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

  if (results.comparison) {
    const ref = results.comparison.comparisons.find((c) => c.mode === "D") ?? results.comparison.comparisons[0];
    if (ref) {
      sections.push({
        title: "Comparison with production (Enter)",
        description: `N = ${fmtInt(ref.n)}; experiment values from mode ${ref.mode}. Tolerance ${ref.tolerance}.`,
        component: "Production comparison",
        spec: table(
          "Production vs experiment",
          [["Variable", "label"], ["B (production)", "bp"], ["B (experiment)", "be"], ["|ΔB|", "db"], ["S.E. (production)", "sp"], ["S.E. (experiment)", "se"], ["|ΔS.E.|", "ds"]],
          ref.rows.map((r) => ({
            label: r.label,
            bp: fmtNum(r.bProduction, 6),
            be: fmtNum(r.bExperiment, 6),
            db: fmtDiff(r.absDiffB),
            sp: fmtNum(r.seProduction, 6),
            se: fmtNum(r.seExperiment, 6),
            ds: fmtDiff(r.absDiffSe),
          }))
        ),
      });
    }
  }

  if (sections.length === 0) return 0;

  const { addLog, addAnalytic, addStatistic } = useResultStore.getState();
  const logId = await addLog({ log: "BINARY LOGISTIC EXPERIMENT (2x2: JavaScript vs Rust-Wasm × main thread vs Web Worker)" });
  const analyticId = await addAnalytic(logId, {
    title: "Binary Logistic (Experiment)",
    note: "Method: Enter",
  });
  for (const s of sections) {
    await addStatistic(analyticId, {
      title: s.title,
      description: s.description,
      output_data: JSON.stringify({ tables: [s.spec] }),
      components: s.component,
    });
  }
  return sections.length;
}
