"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, FlaskConical, Loader2, Play, Scale, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { Variable } from "@/types/Variable";
import type {
  BatchProgress,
  BatchResult,
  BatchSettings,
  ComparisonResult,
  ExperimentMode,
  ExperimentResults,
  ProductionComparison,
  SingleRunResult,
} from "../types/experiment";
import { DEFAULT_MAX_ITER, DEFAULT_TOL, MODES, MODE_ORDER } from "../types/experiment";
import { prepareExperimentData, resample } from "../services/prepareData";
import { ExperimentSession, errorMessage, getMainThreadInit, totalBatchRuns, validateSettings } from "../services/runner";
import { computeAccuracy, computeSummaries, worstAccuracyByN } from "../services/analysis";
import { buildMetaJson, buildRunsCsv, downloadText } from "../services/exportCsv";
import { compareWithProduction, runProductionEnter } from "../services/productionCompare";
import { interRunPause } from "../services/metrics";
import { fmtDiff, fmtDuration, fmtInt } from "../services/format";
import { ResponsivenessIndicator } from "./ResponsivenessIndicator";
import { BatchChart, CHART_METRIC_LABEL, type ChartMetric } from "./BatchChart";
import {
  AccuracyTable,
  CoefficientsTable,
  MODE_AGREEMENT_TOL,
  PassBadge,
  ProductionTable,
  RunMetricsTable,
  SummaryTable,
} from "./ResultTables";

interface ExperimentTabProps {
  dependent: Variable | null;
  covariates: Variable[];
  /** Tab sedang terlihat (indikator rAF hanya jalan saat terlihat). */
  active: boolean;
  onBusyChange: (busy: boolean) => void;
  onResultsChange: (results: ExperimentResults) => void;
}

type Busy = "idle" | "single" | "batch" | "compare";

const PRESET_SIZES = [10_000, 50_000, 100_000] as const;
const IS_PRODUCTION_BUILD = process.env.NODE_ENV === "production";

function parseInteger(text: string, label: string, min: number): number {
  const v = Number(text.trim());
  if (text.trim() === "" || !Number.isInteger(v) || v < min) {
    throw new Error(`${label} must be an integer ≥ ${min}.`);
  }
  return v;
}

function parseSizeList(text: string): number[] {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  return parts.map((p) => parseInteger(p.replace(/_/g, ""), "Each custom N", 1));
}

const sectionTitle = "text-sm font-semibold flex items-center gap-1.5";

function NumberField(props: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id} className="text-xs">
        {props.label}
      </Label>
      <Input
        id={props.id}
        data-testid={props.id}
        className="h-8 w-28"
        inputMode="numeric"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
      />
    </div>
  );
}

export function ExperimentTab({ dependent, covariates, active, onBusyChange, onResultsChange }: ExperimentTabProps) {
  const data = useDataStore((s) => s.data);
  const variables = useVariableStore((s) => s.variables);

  // Data prep untuk validasi & tampilan; dijalankan ulang setiap pilihan/data berubah
  const prepared = useMemo(() => {
    if (!dependent || covariates.length === 0) {
      return { ok: false as const, message: "Select a dependent variable and at least one covariate on the Variables tab." };
    }
    try {
      return { ok: true as const, value: prepareExperimentData(data, variables, dependent, covariates) };
    } catch (err) {
      return { ok: false as const, message: errorMessage(err) };
    }
  }, [data, variables, dependent, covariates]);

  // --- Pengaturan ---
  const [mode, setMode] = useState<ExperimentMode>("A");
  const [singleSize, setSingleSize] = useState<string>("original");
  const [singleCustom, setSingleCustom] = useState("");
  const [sizeChecks, setSizeChecks] = useState<Record<string, boolean>>({
    original: true,
    "10000": true,
    "50000": true,
    "100000": true,
  });
  const [customSizes, setCustomSizes] = useState("");
  const [warmup, setWarmup] = useState("5");
  const [repetitions, setRepetitions] = useState("30");
  const [seed, setSeed] = useState("42");
  const [coldWorkers, setColdWorkers] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("e2eMs");

  // --- Status & hasil ---
  const [busy, setBusy] = useState<Busy>("idle");
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [timing, setTiming] = useState<{ elapsedMs: number; remainingMs: number | null } | null>(null);
  const [single, setSingle] = useState<SingleRunResult | null>(null);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  const sessionRef = useRef<ExperimentSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const session = new ExperimentSession();
    sessionRef.current = session;
    return () => {
      // Dialog ditutup: hentikan batch dan bebaskan worker/observer
      abortRef.current?.abort();
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => onBusyChange(busy !== "idle"), [busy, onBusyChange]);
  useEffect(() => onResultsChange({ single, batch, comparison }), [single, batch, comparison, onResultsChange]);

  const session = () => {
    if (!sessionRef.current) throw new Error("Experiment session is not ready.");
    return sessionRef.current;
  };

  const nOriginal = prepared.ok ? prepared.value.n : null;

  const batchSizesPreview = useMemo(() => {
    if (nOriginal === null) return { sizes: [] as number[], error: null as string | null };
    try {
      const sizes: number[] = [];
      if (sizeChecks.original) sizes.push(nOriginal);
      for (const n of PRESET_SIZES) if (sizeChecks[String(n)]) sizes.push(n);
      sizes.push(...parseSizeList(customSizes));
      return { sizes: [...new Set(sizes)].sort((a, b) => a - b), error: null };
    } catch (err) {
      return { sizes: [], error: errorMessage(err) };
    }
  }, [nOriginal, sizeChecks, customSizes]);

  const totalRunsPreview = (() => {
    try {
      return totalBatchRuns({
        sizes: batchSizesPreview.sizes,
        warmup: parseInteger(warmup, "Warm-up", 0),
        repetitions: parseInteger(repetitions, "Repetitions", 1),
      });
    } catch {
      return null;
    }
  })();

  // --- Run once ---
  const handleRunOnce = async () => {
    if (!prepared.ok) return toast.error(prepared.message);
    const prep = prepared.value;
    let data;
    try {
      const N =
        singleSize === "original"
          ? prep.n
          : singleSize === "custom"
            ? parseInteger(singleCustom, "Custom N", 1)
            : Number(singleSize);
      data = resample(prep.X, prep.y, prep.n, prep.p, N, parseInteger(seed, "Seed", 0));
    } catch (err) {
      return toast.error(errorMessage(err));
    }

    setBusy("single");
    try {
      // Biarkan status "Running…" ter-render sebelum main thread mungkin terblokir
      await interRunPause();
      const record = await session().runSingle(mode, data, { coldWorkers, maxIter: DEFAULT_MAX_ITER, tol: DEFAULT_TOL });
      setSingle({ record, featureNames: prep.featureNames, resampled: data.resampled, nOriginal: prep.n });
      if (record.error) toast.error(`Run failed: ${record.error}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy("idle");
    }
  };

  // --- Batch ---
  const handleRunBatch = async () => {
    if (!prepared.ok) return toast.error(prepared.message);
    const prep = prepared.value;
    let settings: BatchSettings;
    try {
      if (batchSizesPreview.error) throw new Error(batchSizesPreview.error);
      settings = {
        sizes: batchSizesPreview.sizes,
        warmup: parseInteger(warmup, "Warm-up", 0),
        repetitions: parseInteger(repetitions, "Repetitions", 1),
        seed: parseInteger(seed, "Seed", 0),
        coldWorkers,
        maxIter: DEFAULT_MAX_ITER,
        tol: DEFAULT_TOL,
      };
      validateSettings(settings);
    } catch (err) {
      return toast.error(errorMessage(err));
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    setBusy("batch");
    setProgress({ phase: "preparing", N: null, completed: 0, total: totalBatchRuns(settings), message: "Starting…" });
    setTiming(null);
    try {
      const outcome = await session().runBatch(
        prep,
        settings,
        {
          onProgress: (p) => {
            const elapsedMs = performance.now() - startedAt;
            const remainingMs = p.completed > 0 ? (elapsedMs / p.completed) * (p.total - p.completed) : null;
            setProgress(p);
            setTiming({ elapsedMs, remainingMs });
          },
        },
        controller.signal
      );
      const summaries = computeSummaries(outcome.records);
      const accuracy = computeAccuracy(outcome.records);
      setBatch({ outcome, summaries, accuracy, featureNames: prep.featureNames });
      if (outcome.meta.status === "error") toast.error(`Batch failed: ${outcome.errorMessage}`);
      else if (outcome.meta.status === "cancelled") toast.info(`Batch cancelled after ${outcome.records.length} recorded runs.`);
      else toast.success(`Batch finished: ${outcome.records.length} runs recorded.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      abortRef.current = null;
      setBusy("idle");
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  const handleDownloadCsv = () => {
    if (!batch) return;
    const { outcome, featureNames } = batch;
    downloadText(`${outcome.meta.batchId}.csv`, buildRunsCsv(outcome.records, outcome.meta, featureNames), "text/csv;charset=utf-8");
  };

  const handleDownloadMeta = () => {
    if (!batch) return;
    const { outcome, summaries, accuracy, featureNames } = batch;
    downloadText(`${outcome.meta.batchId}-meta.json`, buildMetaJson(outcome.meta, summaries, accuracy, featureNames), "application/json");
  };

  // --- Compare with production ---
  const handleCompare = async () => {
    if (!prepared.ok) return toast.error(prepared.message);
    const prep = prepared.value;
    setBusy("compare");
    try {
      const production = await runProductionEnter(prep);
      const data = { X: prep.X, y: prep.y, n: prep.n, p: prep.p, resampled: false };
      const comparisons: ProductionComparison[] = [];
      for (const m of MODE_ORDER) {
        const record = await session().runSingle(m, data, { coldWorkers: false, maxIter: DEFAULT_MAX_ITER, tol: DEFAULT_TOL });
        if (!record.result) throw new Error(`Mode ${m} failed: ${record.error}`);
        comparisons.push(compareWithProduction(production, record.result, prep.featureNames, m, prep.n));
      }
      setComparison({ comparisons });
      const allPassed = comparisons.every((c) => c.passed);
      if (allPassed) toast.success("All four modes match production Enter within 1e-4.");
      else toast.error("Some modes differ from production by more than 1e-4.");
    } catch (err) {
      toast.error(`Comparison failed: ${errorMessage(err)}`);
    } finally {
      setBusy("idle");
    }
  };

  const isBusy = busy !== "idle";
  const canRun = prepared.ok && !isBusy;
  const progressPct = progress && progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0;
  const worst = batch ? worstAccuracyByN(batch.accuracy) : [];
  const hiddenRuns = batch ? batch.outcome.records.filter((r) => r.pageHidden).length : 0;

  return (
    <div className="space-y-6 py-4" data-testid="bl-exp-experiment-tab">
      {!IS_PRODUCTION_BUILD && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            Development build: timings are not representative. Benchmark only on a production build (
            <code>npm run build</code> then <code>next start</code>).
          </span>
        </div>
      )}

      <div className="rounded-md border border-border px-3 py-2 text-xs" data-testid="bl-exp-dataset-info">
        {prepared.ok ? (
          <span>
            Dependent <strong>{prepared.value.dependent.name}</strong> (
            {Object.entries(prepared.value.yEncoding)
              .map(([k, v]) => `${k} → ${v}`)
              .join(", ")}
            ) · Covariates {prepared.value.covariates.map((c) => c.name).join(", ")} · N ={" "}
            <strong data-testid="bl-exp-n-original">{fmtInt(prepared.value.n)}</strong> after listwise deletion (
            {fmtInt(prepared.value.nMissing)} dropped) · p = {prepared.value.p} incl. constant · Method: Enter
          </span>
        ) : (
          <span className="text-muted-foreground">{prepared.message}</span>
        )}
      </div>

      <ResponsivenessIndicator active={active} />

      {/* ---------------- Run once ---------------- */}
      <section className="space-y-3">
        <h3 className={sectionTitle}>
          <Play className="h-4 w-4 text-primary" aria-hidden /> Run once
        </h3>
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as ExperimentMode)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          disabled={isBusy}
          aria-label="Configuration"
        >
          {MODE_ORDER.map((m) => (
            <Label
              key={m}
              htmlFor={`bl-exp-mode-${m}`}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal",
                mode === m ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <RadioGroupItem value={m} id={`bl-exp-mode-${m}`} data-testid={`bl-exp-mode-${m}`} />
              {MODES[m].label}
            </Label>
          ))}
        </RadioGroup>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="bl-exp-single-size" className="text-xs">
              Data size N
            </Label>
            <select
              id="bl-exp-single-size"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={singleSize}
              onChange={(e) => setSingleSize(e.target.value)}
              disabled={isBusy}
            >
              <option value="original">Original{nOriginal !== null ? ` (${fmtInt(nOriginal)})` : ""}</option>
              {PRESET_SIZES.map((n) => (
                <option key={n} value={String(n)}>
                  {fmtInt(n)} (resampled)
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>
          {singleSize === "custom" && (
            <div className="space-y-1">
              <Label htmlFor="bl-exp-single-custom" className="text-xs">
                Custom N
              </Label>
              <Input
                id="bl-exp-single-custom"
                className="h-8 w-32"
                inputMode="numeric"
                value={singleCustom}
                onChange={(e) => setSingleCustom(e.target.value)}
                disabled={isBusy}
              />
            </div>
          )}
          <Button onClick={handleRunOnce} disabled={!canRun} data-testid="bl-exp-run-once">
            {busy === "single" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {busy === "single" ? "Running…" : "Run once"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Resampled sizes draw rows with replacement using the batch seed. Worker modes reuse a warm worker unless
          “fresh worker per run” is checked below.
        </p>

        {single && (
          <div className="space-y-2 rounded-md border border-border p-3" data-testid="bl-exp-single-result" data-mode={single.record.mode}>
            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">{MODES[single.record.mode].label}</strong> · N = {fmtInt(single.record.N)}
              {single.resampled ? " (resampled)" : " (original data)"} · p = {single.record.p}
              {single.record.workerStart ? ` · ${single.record.workerStart} worker` : ""} · {single.record.timestamp}
            </div>
            {single.record.error && <div className="text-sm text-destructive">{single.record.error}</div>}
            <div className="flex flex-wrap gap-4">
              {single.record.result && (
                <div className="min-w-[260px] flex-1">
                  <CoefficientsTable result={single.record.result} featureNames={single.featureNames} />
                </div>
              )}
              <div className="min-w-[260px] flex-1">
                <RunMetricsTable
                  record={single.record}
                  mainInit={getMainThreadInit()}
                  warmInit={sessionRef.current?.warmWorkerInit ?? {}}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---------------- Batch ---------------- */}
      <section className="space-y-3">
        <h3 className={sectionTitle}>
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden /> Batch benchmark (all 4 modes)
        </h3>
        <div className="space-y-2">
          <div className="text-xs font-medium">Data sizes N</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sizeChecks.original}
                onCheckedChange={(c) => setSizeChecks((s) => ({ ...s, original: c === true }))}
                disabled={isBusy}
                data-testid="bl-exp-size-original"
              />
              Original{nOriginal !== null ? ` (${fmtInt(nOriginal)})` : ""}
            </label>
            {PRESET_SIZES.map((n) => (
              <label key={n} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={sizeChecks[String(n)]}
                  onCheckedChange={(c) => setSizeChecks((s) => ({ ...s, [String(n)]: c === true }))}
                  disabled={isBusy}
                  data-testid={`bl-exp-size-${n}`}
                />
                {fmtInt(n)}
              </label>
            ))}
            <div className="flex items-center gap-2">
              <Label htmlFor="bl-exp-custom-sizes" className="text-sm font-normal">
                Custom
              </Label>
              <Input
                id="bl-exp-custom-sizes"
                className="h-8 w-40"
                placeholder="e.g. 250000, 500000"
                value={customSizes}
                onChange={(e) => setCustomSizes(e.target.value)}
                disabled={isBusy}
              />
            </div>
          </div>
          {batchSizesPreview.error && <div className="text-xs text-destructive">{batchSizesPreview.error}</div>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <NumberField id="bl-exp-warmup" label="Warm-up runs" value={warmup} onChange={setWarmup} disabled={isBusy} />
          <NumberField id="bl-exp-repetitions" label="Repetitions" value={repetitions} onChange={setRepetitions} disabled={isBusy} />
          <NumberField id="bl-exp-seed" label="Seed" value={seed} onChange={setSeed} disabled={isBusy} />
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <Checkbox
              checked={coldWorkers}
              onCheckedChange={(c) => setColdWorkers(c === true)}
              disabled={isBusy}
              data-testid="bl-exp-cold-workers"
            />
            Fresh worker per run (cold)
          </label>
        </div>
        <div className="text-xs text-muted-foreground">
          {totalRunsPreview !== null
            ? `${batchSizesPreview.sizes.length} size(s) × (warm-up + repetitions) × 4 modes = ${fmtInt(totalRunsPreview)} runs; mode order is shuffled per repetition with the seed. Warm-up runs are not recorded.`
            : "Enter valid warm-up and repetition counts."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleRunBatch} disabled={!canRun} data-testid="bl-exp-run-batch">
            {busy === "batch" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Run batch
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={busy !== "batch"} data-testid="bl-exp-cancel">
            <Square className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          {batch && (
            <>
              <Button variant="outline" onClick={handleDownloadCsv} disabled={isBusy} data-testid="bl-exp-download-csv">
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <Button variant="outline" onClick={handleDownloadMeta} disabled={isBusy} data-testid="bl-exp-download-meta">
                <Download className="mr-2 h-4 w-4" />
                meta.json
              </Button>
            </>
          )}
        </div>

        {progress && (busy === "batch" || progress.phase !== "done") && (
          <div className="space-y-1" data-testid="bl-exp-progress">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.completed}
            >
              <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {fmtInt(progress.completed)} / {fmtInt(progress.total)} · {progress.message}
              </span>
              {timing && (
                <span className="tabular-nums">
                  {fmtDuration(timing.elapsedMs)} elapsed
                  {timing.remainingMs !== null && busy === "batch" ? ` · ~${fmtDuration(timing.remainingMs)} left` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {batch && (
          <div className="space-y-4" data-testid="bl-exp-batch-result" data-status={batch.outcome.meta.status}>
            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">{batch.outcome.meta.batchId}</strong> · status{" "}
              {batch.outcome.meta.status} · {fmtInt(batch.outcome.records.length)} recorded runs ·{" "}
              {batch.outcome.meta.settings.coldWorkers ? "cold" : "warm"} workers · seed {batch.outcome.meta.settings.seed}
              {batch.outcome.errorMessage ? ` · ${batch.outcome.errorMessage}` : ""}
            </div>
            {hiddenRuns > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span>
                  {hiddenRuns} run(s) happened while the tab was hidden; requestAnimationFrame pauses in background tabs, so
                  their frame metrics are invalid (column <code>pageHidden</code> in the CSV). Keep the tab visible during a
                  batch.
                </span>
              </div>
            )}
            {batch.summaries.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="bl-exp-chart-metric" className="text-xs">
                    Chart metric
                  </Label>
                  <select
                    id="bl-exp-chart-metric"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={chartMetric}
                    onChange={(e) => setChartMetric(e.target.value as ChartMetric)}
                  >
                    {(Object.keys(CHART_METRIC_LABEL) as ChartMetric[]).map((k) => (
                      <option key={k} value={k}>
                        {CHART_METRIC_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <BatchChart summaries={batch.summaries} metric={chartMetric} />
                <div className="overflow-x-auto">
                  <SummaryTable summaries={batch.summaries} />
                </div>
              </>
            )}
            {batch.accuracy.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-medium">Accuracy across modes (reference: mode D)</span>
                  {worst.map((w) => (
                    <PassBadge
                      key={w.N}
                      passed={w.beta < MODE_AGREEMENT_TOL && w.se < MODE_AGREEMENT_TOL}
                      label={`N ${fmtInt(w.N)}: max ${fmtDiff(Math.max(w.beta, w.se))}`}
                    />
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <AccuracyTable accuracy={batch.accuracy} />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------- Production ---------------- */}
      <section className="space-y-3">
        <h3 className={sectionTitle}>
          <Scale className="h-4 w-4 text-primary" aria-hidden /> Compare with production
        </h3>
        <p className="text-xs text-muted-foreground">
          Runs the production <code>calculate_binary_logistic</code> (method Enter, default options) through the production
          worker on the original data, then runs all four modes once on the same data and compares B and S.E.
          (Constant ↔ intercept column). Pass criterion: max difference &lt; 1e-4.
        </p>
        <Button variant="outline" onClick={handleCompare} disabled={!canRun} data-testid="bl-exp-compare-production">
          {busy === "compare" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scale className="mr-2 h-4 w-4" />}
          Compare with production
        </Button>
        {comparison && (
          <div className="overflow-x-auto">
            <ProductionTable comparisons={comparison.comparisons} />
          </div>
        )}
      </section>
    </div>
  );
}
