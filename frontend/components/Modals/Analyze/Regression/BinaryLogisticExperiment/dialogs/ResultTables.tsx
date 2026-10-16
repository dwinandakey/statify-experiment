"use client";

import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  AccuracyRow,
  CoreResult,
  InitTimings,
  ModeSummary,
  ProductionComparison,
  RunRecord,
  SummaryStats,
  WarmWorkerInit,
} from "../types/experiment";
import { MODES } from "../types/experiment";
import { MODE_AGREEMENT_TOL, accuracyPassed } from "../services/analysis";
import { fmtDiff, fmtInt, fmtMB, fmtMs, fmtNum } from "../services/format";

export { MODE_AGREEMENT_TOL };

const num = "text-right tabular-nums";

export function PassBadge({ passed, label }: { passed: boolean; label?: string }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {label ?? "PASS"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
      <XCircle className="h-3.5 w-3.5" aria-hidden />
      {label ?? "FAIL"}
    </span>
  );
}

export function CoefficientsTable({ result, featureNames }: { result: CoreResult; featureNames: string[] }) {
  return (
    <Table data-testid="bl-exp-coef-table">
      <TableHeader>
        <TableRow>
          <TableHead>Variable</TableHead>
          <TableHead className="text-right">B</TableHead>
          <TableHead className="text-right">S.E.</TableHead>
          <TableHead className="text-right">Exp(B)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {featureNames.map((name, j) => (
          <TableRow key={name + j}>
            <TableCell className="font-medium">{name}</TableCell>
            <TableCell className={num} data-testid={`bl-exp-coef-b-${j}`} data-value={String(result.beta[j])}>
              {fmtNum(result.beta[j], 6)}
            </TableCell>
            <TableCell className={num} data-testid={`bl-exp-coef-se-${j}`} data-value={String(result.se[j])}>
              {fmtNum(result.se[j], 6)}
            </TableCell>
            <TableCell className={num}>{fmtNum(Math.exp(result.beta[j]), 6)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MetricRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{label}</TableCell>
      <TableCell className={num}>{value}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{hint}</TableCell>
    </TableRow>
  );
}

export function RunMetricsTable({
  record,
  mainInit,
  warmInit,
}: {
  record: RunRecord;
  mainInit: InitTimings;
  warmInit: Partial<Record<"B" | "D", WarmWorkerInit>>;
}) {
  const r = record.result;
  const isWorker = MODES[record.mode].location === "worker";
  const warm = record.mode === "B" || record.mode === "D" ? warmInit[record.mode] : undefined;
  return (
    <Table data-testid="bl-exp-metrics-table">
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <MetricRow label="-2LL" value={fmtNum(r?.neg2ll, 4)} />
        <MetricRow label="iterations" value={fmtInt(r?.iterations)} hint={r ? (r.converged ? "converged" : "NOT converged") : undefined} />
        <MetricRow label="stepHalvings" value={fmtInt(r?.stepHalvings)} />
        <MetricRow label="computeMs" value={fmtMs(record.computeMs, 3)} hint="core IRLS, measured where it runs" />
        <MetricRow label="e2eMs" value={fmtMs(record.e2eMs, 3)} hint="main thread: dispatch → result available" />
        <MetricRow label="overheadMs" value={fmtMs(record.overheadMs, 3)} hint="e2eMs − computeMs" />
        {r?.wasmCoreMs !== null && r?.wasmCoreMs !== undefined && (
          <MetricRow label="wasmCoreMs" value={fmtMs(r.wasmCoreMs, 3)} hint="inside Wasm, excl. copy-in & serialization" />
        )}
        {record.wasmSerializeMs !== null && (
          <MetricRow label="wasmSerializeMs" value={fmtMs(record.wasmSerializeMs, 3)} hint="serde_json inside Wasm" />
        )}
        {record.workerStart === "cold" && (
          <>
            <MetricRow label="spawnMs" value={fmtMs(record.spawnMs, 3)} hint="new Worker → ready, minus initMs" />
            <MetricRow label="initMs" value={fmtMs(record.initMs, 3)} hint="init inside the worker" />
          </>
        )}
        {record.workerStart === "warm" && warm && (
          <MetricRow
            label="warm worker"
            value={`${fmtMs(warm.spawnMs, 1)} / ${fmtMs(warm.initMs, 1)}`}
            hint="spawnMs / initMs, paid once before this run"
          />
        )}
        {!isWorker && record.mode === "A" && (
          <MetricRow label="page-load import" value={fmtMs(mainInit.jsImportMs, 1)} hint="irls_core.js, once per page load" />
        )}
        {!isWorker && record.mode === "C" && (
          <MetricRow
            label="page-load init"
            value={`${fmtMs(mainInit.wasmImportMs, 1)} / ${fmtMs(mainInit.wasmInitMs, 1)}`}
            hint="import glue / wasm init, once per page load"
          />
        )}
        <MetricRow label="maxFrameGapMs" value={fmtMs(record.maxFrameGapMs, 1)} hint={`${fmtInt(record.frameCount)} frames observed`} />
        <MetricRow
          label="droppedFrames"
          value={fmtInt(record.droppedFrames)}
          hint={`≈ missed frames: Σ round(gap / T) − 1, T = ${fmtMs(record.frameIntervalMs, 1)} ms`}
        />
        <MetricRow label="longGapCount" value={fmtInt(record.longGapCount)} hint="number of gaps > 2T (not frames)" />
        <MetricRow
          label="longTasks"
          value={record.longTaskCount === null ? "n/a" : `${record.longTaskCount} · ${fmtMs(record.longTaskTotalMs, 1)} ms`}
          hint={record.longTaskCount === null ? "PerformanceObserver longtask not supported" : "count · total"}
        />
        <MetricRow
          label="mainHeapUsedMB"
          value={fmtMB(record.mainHeapUsedMB)}
          hint="main-thread JS heap only (Chromium); worker memory not included, do not compare across locations"
        />
        {record.wasmMemoryMB !== null && <MetricRow label="wasmMemoryMB" value={fmtMB(record.wasmMemoryMB)} hint="wasm linear memory" />}
      </TableBody>
    </Table>
  );
}

// Median (baris 1), IQR (baris 2), rentang min–max (baris 3): sempit agar muat di sidebar
const statCell = (s: SummaryStats | null) =>
  s ? (
    <span className="whitespace-nowrap leading-tight">
      <span className="font-medium">{fmtMs(s.median)}</span>
      <br />
      <span className="text-xs text-muted-foreground">
        [{fmtMs(s.q1)}–{fmtMs(s.q3)}]
      </span>
      <br />
      <span className="text-xs text-muted-foreground">
        {fmtMs(s.min)}–{fmtMs(s.max)}
      </span>
    </span>
  ) : (
    "–"
  );

/** Label mode ringkas untuk tabel: huruf + teknologi · lokasi. */
function ModeCell({ mode }: { mode: keyof typeof MODES }) {
  return (
    <span className="whitespace-nowrap" title={MODES[mode].label}>
      <span className="font-semibold">{mode}</span> <span className="text-muted-foreground">{MODES[mode].short}</span>
    </span>
  );
}

export function SummaryTable({ summaries }: { summaries: ModeSummary[] }) {
  // Analisis lengkap: tambah formatter SPSS dan total sampai tabel siap
  const full = summaries.some((s) => s.totalMs !== null);
  return (
    <Table data-testid="bl-exp-summary-table">
      <caption className="mb-1 text-left text-xs text-muted-foreground" style={{ captionSide: "top" }}>
        Milliseconds: median, [Q1–Q3], min–max over successful runs. in Wasm = wasmCoreMs (C/D only): time inside
        Wasm without copying the input in and without serializing the result.
        {full && " total = dispatch → SPSS tables formatted (compute + transfer + format)."}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">N</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead className="text-right">compute</TableHead>
          <TableHead className="text-right">e2e</TableHead>
          {full && <TableHead className="text-right">format</TableHead>}
          {full && <TableHead className="text-right">total</TableHead>}
          <TableHead className="text-right">frame gap</TableHead>
          <TableHead className="text-right whitespace-nowrap">in Wasm</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaries.map((s) => (
          <TableRow key={`${s.N}-${s.mode}`}>
            <TableCell className={num}>{fmtInt(s.N)}</TableCell>
            <TableCell>
              <ModeCell mode={s.mode} />
              <div className="text-xs text-muted-foreground">
                {s.runs} runs
                {s.errors > 0 && <span className="text-destructive"> · {s.errors} errors</span>}
              </div>
            </TableCell>
            <TableCell className={num}>{statCell(s.computeMs)}</TableCell>
            <TableCell className={num}>{statCell(s.e2eMs)}</TableCell>
            {full && <TableCell className={num}>{statCell(s.formatMs)}</TableCell>}
            {full && (
              <TableCell className={num} data-testid={`bl-exp-total-${s.N}-${s.mode}`}>
                {statCell(s.totalMs)}
              </TableCell>
            )}
            <TableCell className={num}>{statCell(s.maxFrameGapMs)}</TableCell>
            <TableCell className={num}>{statCell(s.wasmCoreMs)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function AccuracyTable({ accuracy }: { accuracy: AccuracyRow[] }) {
  const full = accuracy.some((a) => a.tablesIdentical !== null);
  return (
    <Table data-testid="bl-exp-accuracy-table">
      <caption className="mb-1 text-left text-xs text-muted-foreground" style={{ captionSide: "top" }}>
        {full
          ? `Max difference vs the first run of mode D at the same N, over all runs. Pass if all SPSS tables are identical to that run and the scaled difference |Δ| / max(1, |value|) of B and S.E. is < ${MODE_AGREEMENT_TOL}.`
          : `Max absolute difference vs the first run of mode D at the same N, over all runs; pass if both < ${MODE_AGREEMENT_TOL}.`}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">N</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead className="text-right whitespace-nowrap">|ΔB|</TableHead>
          <TableHead className="text-right whitespace-nowrap">|ΔS.E.|</TableHead>
          <TableHead className="text-right">Iter.</TableHead>
          <TableHead className="text-right">Halv.</TableHead>
          {full && <TableHead className="text-right whitespace-nowrap">SPSS tables</TableHead>}
          <TableHead>Pass</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accuracy.map((a) => (
          <TableRow key={`${a.N}-${a.mode}`}>
            <TableCell className={num}>{fmtInt(a.N)}</TableCell>
            <TableCell>
              <ModeCell mode={a.mode} />
            </TableCell>
            <TableCell className={num} data-testid={`bl-exp-acc-beta-${a.N}-${a.mode}`} data-value={String(a.maxAbsDiffBeta)}>
              {fmtDiff(a.maxAbsDiffBeta)}
            </TableCell>
            <TableCell className={num}>{fmtDiff(a.maxAbsDiffSe)}</TableCell>
            <TableCell className={num}>{fmtInt(a.iterations)}</TableCell>
            <TableCell className={num}>{fmtInt(a.stepHalvings)}</TableCell>
            {full && (
              <TableCell
                className={num}
                data-testid={`bl-exp-acc-tables-${a.N}-${a.mode}`}
                data-identical={a.tablesIdentical ? String(a.tablesIdentical.identical) : ""}
                data-total={a.tablesIdentical ? String(a.tablesIdentical.total) : ""}
              >
                {a.tablesIdentical ? `${a.tablesIdentical.identical}/${a.tablesIdentical.total}` : "–"}
              </TableCell>
            )}
            <TableCell>
              <PassBadge passed={accuracyPassed(a)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ProductionTable({ comparisons }: { comparisons: ProductionComparison[] }) {
  const ref = comparisons.find((c) => c.mode === "D") ?? comparisons[0];
  if (!ref) return null;
  const maxOver = (j: number, key: "absDiffB" | "absDiffSe") => Math.max(...comparisons.map((c) => c.rows[j][key]));
  return (
    <div className="space-y-3">
      <Table data-testid="bl-exp-production-table">
        <TableHeader>
          <TableRow>
            <TableHead>Variable</TableHead>
            <TableHead className="text-right">B (production)</TableHead>
            <TableHead className="text-right">B (mode {ref.mode})</TableHead>
            <TableHead className="text-right">max |ΔB| (A–D)</TableHead>
            <TableHead className="text-right">S.E. (production)</TableHead>
            <TableHead className="text-right">S.E. (mode {ref.mode})</TableHead>
            <TableHead className="text-right">max |ΔS.E.| (A–D)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ref.rows.map((row, j) => (
            <TableRow key={row.label + j}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className={num}>{fmtNum(row.bProduction, 6)}</TableCell>
              <TableCell className={num}>{fmtNum(row.bExperiment, 6)}</TableCell>
              <TableCell className={num}>{fmtDiff(maxOver(j, "absDiffB"))}</TableCell>
              <TableCell className={num}>{fmtNum(row.seProduction, 6)}</TableCell>
              <TableCell className={num}>{fmtNum(row.seExperiment, 6)}</TableCell>
              <TableCell className={num}>{fmtDiff(maxOver(j, "absDiffSe"))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          -2LL production {fmtNum(ref.neg2llProduction, 4)} · experiment {fmtNum(ref.neg2llExperiment, 4)}
        </span>
        <span>
          iterations production {fmtInt(ref.iterationsProduction)} · experiment {fmtInt(ref.iterationsExperiment)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1" data-testid="bl-exp-production-status">
        {comparisons.map((c) => {
          const maxDiff = Math.max(c.maxAbsDiffB, c.maxAbsDiffSe);
          return (
            <span key={c.mode} className="text-xs" data-testid={`bl-exp-production-${c.mode}`} data-max-diff={String(maxDiff)}>
              <PassBadge
                passed={c.passed}
                label={`${c.mode} ${c.passed ? "PASS" : "FAIL"} · max |Δ| ${fmtDiff(maxDiff)} (tolerance ${c.tolerance})`}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}
