// Bandingkan batch workload "core" (IRLS identik di JS dan Rust: efek runtime)
// dengan "full" (analisis lengkap: port JS vs jalur produksi nalgebra, efek
// runtime + implementasi) dari CSV hasil Download CSV.
//
// Jalankan (Node >= 18):
//   node compareWorkloads.mjs batch-....csv batch-full-....csv [lainnya.csv ...]
// Keluaran Markdown ke stdout:
//   1. median computeMs per (workload, N, mode) + median wasmCoreMs (C/D);
//   2. rasio Wasm/JS per lokasi (C/A main thread, D/B worker) per N;
//   3. biaya per baris: slope OLS computeMs ~ N per (workload, mode), dalam µs/baris,
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
    runs.push({ ...r, file: basename(file), workload: r.workload || "core" });
  }
}
const workloads = [...new Set(runs.map((r) => r.workload))];
const sizes = [...new Set(runs.map((r) => num(r.N)))].sort((a, b) => a - b);
const modes = ["A", "B", "C", "D"];
const sel = (w, N, m) => runs.filter((r) => r.workload === w && num(r.N) === N && r.mode === m);
const med = (w, N, m, key) => median(sel(w, N, m).map((r) => num(r[key])));

console.log(`# Workload comparison\n\nFiles: ${files.map((x) => basename(x)).join(", ")}  `);
console.log(`Runs used: ${runs.length} (phase measure, no error, page visible)\n`);

console.log("## Median computeMs (ms) per N × mode; [in Wasm] = median wasmCoreMs for C/D\n");
console.log(`| workload | N | A JS·main | B JS·worker | C Wasm·main | D Wasm·worker | C in Wasm | D in Wasm |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|---:|`);
for (const w of workloads) {
  for (const N of sizes) {
    const c = modes.map((m) => f(med(w, N, m, "computeMs")));
    console.log(`| ${w} | ${N} | ${c.join(" | ")} | ${f(med(w, N, "C", "wasmCoreMs"))} | ${f(med(w, N, "D", "wasmCoreMs"))} |`);
  }
}

console.log("\n## Wasm / JS ratio of median computeMs (< 1: Wasm faster)\n");
console.log(`| workload | N | main thread C/A | worker D/B | in-Wasm C / JS A |`);
console.log(`|---|---:|---:|---:|---:|`);
for (const w of workloads) {
  for (const N of sizes) {
    const a = med(w, N, "A", "computeMs");
    console.log(
      `| ${w} | ${N} | ${f(med(w, N, "C", "computeMs") / a, 3)} | ${f(med(w, N, "D", "computeMs") / med(w, N, "B", "computeMs"), 3)} | ${f(med(w, N, "C", "wasmCoreMs") / a, 3)} |`
    );
  }
}

console.log("\n## Per-row cost: OLS slope of computeMs on N (all runs)\n");
console.log(`| workload | mode | slope (µs/row) | intercept (ms) | in-Wasm slope (µs/row) | boundary slope (µs/row) |`);
console.log(`|---|---|---:|---:|---:|---:|`);
for (const w of workloads) {
  for (const m of modes) {
    const rs = runs.filter((r) => r.workload === w && r.mode === m);
    const all = ols(rs.map((r) => [num(r.N), num(r.computeMs)]));
    const inWasm = ols(rs.map((r) => [num(r.N), num(r.wasmCoreMs)]));
    const boundary = ols(
      rs.map((r) => [num(r.N), num(r.computeMs) - num(r.wasmCoreMs) - (Number.isFinite(num(r.wasmSerializeMs)) ? num(r.wasmSerializeMs) : 0)])
    );
    console.log(
      `| ${w} | ${m} | ${f(all.slope * 1000, 3)} | ${f(all.intercept, 2)} | ${f(inWasm.slope * 1000, 3)} | ${f(boundary.slope * 1000, 3)} |`
    );
  }
}
