// Bandingkan batch workload "core" (IRLS identik di JS dan Rust: efek runtime)
// dengan "full" (analisis lengkap: port JS vs jalur produksi nalgebra, efek
// runtime + implementasi) dari CSV hasil Download CSV.
//
// Jalankan (Node >= 18):
//   node compareWorkloads.mjs batch-....csv batch-full-....csv [lainnya.csv ...]
// Keluaran Markdown ke stdout, dikelompokkan per SEL (mode + siklus hidup worker:
// A, B-warm, B-cold, C, D-warm, D-cold). CSV v1 tanpa kolom `cell` dipetakan dari
// mode + workerStart, jadi batch persistent dan per-run v1 bisa digabung:
//   1. median computeMs per (workload, N, sel) + median wasmCoreMs (sel C/D);
//   2. rasio Wasm/JS per lokasi dan siklus hidup (C/A main thread, D-warm/B-warm,
//      D-cold/B-cold) per N;
//   3. biaya per baris: slope OLS computeMs ~ N per (workload, sel), dalam µs/baris,
//      dan intercept (ms); untuk C/D juga slope wasmCoreMs (di dalam Wasm) dan
//      sisa boundary (computeMs − wasmCoreMs − wasmSerializeMs).
// Hanya run phase "measure" tanpa error dan tanpa pageHidden yang dipakai.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function parseCsv(text) {
  const rows = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line) continue;
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Sel sebuah baris: kolom `cell` (v2) atau mode + workerStart (v1). */
function cellOf(row) {
  if (row.cell) return row.cell;
  return row.workerStart === "warm" || row.workerStart === "cold" ? `${row.mode}-${row.workerStart}` : row.mode;
}

const num = (v) => (v === undefined || v === "" ? NaN : Number(v));
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const h = (v.length - 1) * 0.5;
  return v[Math.floor(h)] + (h - Math.floor(h)) * (v[Math.ceil(h)] - v[Math.floor(h)]);
};
/** OLS y = a + b·x; kembalikan { slope, intercept }. */
function ols(points) {
  const p = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (p.length < 2) return { slope: NaN, intercept: NaN };
  const mx = p.reduce((s, [x]) => s + x, 0) / p.length;
  const my = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of p) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "–");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node compareWorkloads.mjs <batch.csv> [<batch.csv> ...]");
  process.exit(1);
}
const runs = [];
for (const file of files) {
  for (const r of parseCsv(readFileSync(file, "utf8"))) {
    if ((r.phase ?? "measure") !== "measure" || r.error || r.pageHidden === "true") continue;
    runs.push({ ...r, file: basename(file), workload: r.workload || "core", cell: cellOf(r) });
  }
}
const CELL_ORDER = ["A", "B-warm", "B-cold", "C", "D-warm", "D-cold"];
const workloads = [...new Set(runs.map((r) => r.workload))];
const sizes = [...new Set(runs.map((r) => num(r.N)))].sort((a, b) => a - b);
const cells = CELL_ORDER.filter((c) => runs.some((r) => r.cell === c));
const sel = (w, N, c) => runs.filter((r) => r.workload === w && num(r.N) === N && r.cell === c);
const med = (w, N, c, key) => median(sel(w, N, c).map((r) => num(r[key])));

console.log(`# Workload comparison\n\nFiles: ${files.map((x) => basename(x)).join(", ")}  `);
console.log(`Runs used: ${runs.length} (phase measure, no error, page visible)\n`);

console.log("## Median computeMs (ms) per N × cell; [in Wasm] = median wasmCoreMs for C/D cells\n");
const wasmCells = cells.filter((c) => c.startsWith("C") || c.startsWith("D"));
console.log(`| workload | N | ${cells.join(" | ")} | ${wasmCells.map((c) => `${c} in Wasm`).join(" | ")} |`);
console.log(`|---|---:|${cells.map(() => "---:").join("|")}|${wasmCells.map(() => "---:").join("|")}|`);
for (const w of workloads) {
  for (const N of sizes) {
    const c = cells.map((cell) => f(med(w, N, cell, "computeMs")));
    const inWasm = wasmCells.map((cell) => f(med(w, N, cell, "wasmCoreMs")));
    console.log(`| ${w} | ${N} | ${c.join(" | ")} | ${inWasm.join(" | ")} |`);
  }
}

console.log("\n## Wasm / JS ratio of median computeMs (< 1: Wasm faster)\n");
const pairs = [
  ["main thread C/A", "C", "A"],
  ["worker persistent D-warm/B-warm", "D-warm", "B-warm"],
  ["worker per-run D-cold/B-cold", "D-cold", "B-cold"],
].filter(([, wasm, js]) => cells.includes(wasm) && cells.includes(js));
console.log(`| workload | N | ${pairs.map(([label]) => label).join(" | ")} | in-Wasm C / JS A |`);
console.log(`|---|---:|${pairs.map(() => "---:").join("|")}|---:|`);
for (const w of workloads) {
  for (const N of sizes) {
    const ratios = pairs.map(([, wasm, js]) => f(med(w, N, wasm, "computeMs") / med(w, N, js, "computeMs"), 3));
    console.log(`| ${w} | ${N} | ${ratios.join(" | ")} | ${f(med(w, N, "C", "wasmCoreMs") / med(w, N, "A", "computeMs"), 3)} |`);
  }
}

console.log("\n## Per-row cost: OLS slope of computeMs on N (all runs)\n");
console.log(`| workload | cell | slope (µs/row) | intercept (ms) | in-Wasm slope (µs/row) | boundary slope (µs/row) |`);
console.log(`|---|---|---:|---:|---:|---:|`);
for (const w of workloads) {
  for (const c of cells) {
    const rs = runs.filter((r) => r.workload === w && r.cell === c);
    const all = ols(rs.map((r) => [num(r.N), num(r.computeMs)]));
    const inWasm = ols(rs.map((r) => [num(r.N), num(r.wasmCoreMs)]));
    const boundary = ols(
      rs.map((r) => [num(r.N), num(r.computeMs) - num(r.wasmCoreMs) - (Number.isFinite(num(r.wasmSerializeMs)) ? num(r.wasmSerializeMs) : 0)])
    );
    console.log(
      `| ${w} | ${c} | ${f(all.slope * 1000, 3)} | ${f(all.intercept, 2)} | ${f(inWasm.slope * 1000, 3)} | ${f(boundary.slope * 1000, 3)} |`
    );
  }
}
