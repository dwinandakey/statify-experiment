"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { CellId, ModeSummary, SummaryStats } from "../types/experiment";
import { fmtInt, fmtMs } from "../services/format";

export type ChartMetric = "e2eMs" | "computeMs" | "maxFrameGapMs" | "totalMs" | "formatMs";

export const CHART_METRIC_LABEL: Record<ChartMetric, string> = {
  e2eMs: "End-to-end (e2eMs)",
  computeMs: "Compute (computeMs)",
  maxFrameGapMs: "Max frame gap (maxFrameGapMs)",
  totalMs: "Incl. SPSS tables (totalMs)",
  formatMs: "SPSS formatting (formatMs)",
};

/** Metrik yang tersedia per workload (formatMs/totalMs hanya untuk analisis lengkap). */
export const CHART_METRICS: Record<"core" | "full", ChartMetric[]> = {
  core: ["e2eMs", "computeMs", "maxFrameGapMs"],
  full: ["totalMs", "e2eMs", "computeMs", "formatMs", "maxFrameGapMs"],
};

/*
 * Small multiples: satu panel per N (skala y masing-masing, karena besaran
 * waktu antar N berbeda jauh). Di tiap panel sumbu x = lokasi eksekusi (dan
 * siklus hidup worker) dan dua seri = teknologi: A/C = main thread, B/D =
 * Web Worker persistent (warm) dan/atau per-run (cold) sesuai sel yang ada di
 * batch; JS = slot kategorikal 1 (biru), Wasm = slot 2 (oranye).
 * Palet divalidasi dataviz/validate_palette.js terhadap surface terang
 * (#ffffff) dan gelap (#0d1117) aplikasi: semua cek PASS.
 * Batang = median, whisker = IQR (Q1–Q3). Tabel ringkasan = table view.
 */
const VIZ_CSS = `
.bl-exp-viz { --viz-js: #2a78d6; --viz-wasm: #eb6834; }
.dark .bl-exp-viz { --viz-js: #3987e5; --viz-wasm: #d95926; }
`;

interface Row {
  location: string;
  js: number | null;
  jsErr: [number, number];
  jsStats: SummaryStats | null;
  jsCell: CellId;
  wasm: number | null;
  wasmErr: [number, number];
  wasmStats: SummaryStats | null;
  wasmCell: CellId;
}

function rowsFor(N: number, summaries: ModeSummary[], metric: ChartMetric): Row[] {
  const atN = summaries.filter((s) => s.N === N);
  const stat = (cell: CellId) => atN.find((s) => s.cell === cell)?.[metric] ?? null;
  const has = (cell: CellId) => atN.some((s) => s.cell === cell);
  const err = (s: SummaryStats | null): [number, number] => (s ? [s.median - s.q1, s.q3 - s.median] : [0, 0]);
  const make = (location: string, jsCell: CellId, wasmCell: CellId): Row => {
    const js = stat(jsCell);
    const wasm = stat(wasmCell);
    return {
      location,
      js: js?.median ?? null,
      jsErr: err(js),
      jsStats: js,
      jsCell,
      wasm: wasm?.median ?? null,
      wasmErr: err(wasm),
      wasmStats: wasm,
      wasmCell,
    };
  };
  const rows = [make("Main thread", "A", "C")];
  if (has("B-warm") || has("D-warm")) rows.push(make("Worker (persistent)", "B-warm", "D-warm"));
  if (has("B-cold") || has("D-cold")) rows.push(make("Worker (per-run)", "B-cold", "D-cold"));
  return rows;
}

function compactTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function ChartTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as Row;
  const lines: { key: string; color: string; cell: CellId; tech: string; s: SummaryStats | null }[] = [
    { key: "js", color: "var(--viz-js)", cell: row.jsCell, tech: "JavaScript", s: row.jsStats },
    { key: "wasm", color: "var(--viz-wasm)", cell: row.wasmCell, tech: "Rust-Wasm", s: row.wasmStats },
  ];
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{row.location}</div>
      {lines.map((l) => (
        <div key={l.key} className="flex items-center gap-2 py-0.5">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: l.color }} aria-hidden />
          <span className="font-semibold tabular-nums text-foreground">{l.s ? `${fmtMs(l.s.median)} ms` : "–"}</span>
          <span className="text-muted-foreground">
            {l.cell} · {l.tech}
            {l.s ? ` · IQR ${fmtMs(l.s.q1)}–${fmtMs(l.s.q3)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--viz-js)" }} aria-hidden />
        JavaScript (A main · B worker)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--viz-wasm)" }} aria-hidden />
        Rust-Wasm (C main · D worker)
      </span>
      <span>Bar = median · whisker = IQR</span>
    </div>
  );
}

export function BatchChart({ summaries, metric }: { summaries: ModeSummary[]; metric: ChartMetric }) {
  const sizes = [...new Set(summaries.map((s) => s.N))].sort((a, b) => a - b);
  if (sizes.length === 0) return null;

  return (
    <div className="bl-exp-viz space-y-3" data-testid="bl-exp-batch-chart">
      <style>{VIZ_CSS}</style>
      <Legend />
      <div className="flex flex-wrap gap-4">
        {sizes.map((N) => {
          const data = rowsFor(N, summaries, metric);
          const aria = data
            .map((r) => `${r.location}: JavaScript ${fmtMs(r.js)} ms, Rust-Wasm ${fmtMs(r.wasm)} ms`)
            .join("; ");
          return (
            <figure
              key={N}
              className="min-w-[240px] flex-1 basis-[280px] rounded-md border border-border p-3"
              role="img"
              aria-label={`N = ${fmtInt(N)}, median ${CHART_METRIC_LABEL[metric]}: ${aria}`}
            >
              <figcaption className="mb-2 text-xs">
                <span className="font-semibold text-foreground">N = {fmtInt(N)}</span>
                <span className="text-muted-foreground"> · median {metric} (ms)</span>
              </figcaption>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data} barGap={2} barCategoryGap="30%" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="location"
                    tickLine={false}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    width={44}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={compactTick}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />}
                  />
                  <Bar dataKey="js" name="JavaScript" fill="var(--viz-js)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    <ErrorBar dataKey="jsErr" width={6} strokeWidth={1} stroke="hsl(var(--muted-foreground))" direction="y" />
                  </Bar>
                  <Bar dataKey="wasm" name="Rust-Wasm" fill="var(--viz-wasm)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    <ErrorBar dataKey="wasmErr" width={6} strokeWidth={1} stroke="hsl(var(--muted-foreground))" direction="y" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
