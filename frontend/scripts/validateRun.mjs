// Validasi satu run orkestrator eksperimen v2 (Tugas 8), lintas-OS.
//
//   node scripts/validateRun.mjs <runDir> [--out <file.md>]
//
// <runDir> = benchmark-results/<runId>. Untuk setiap sesi di run.json:
//   - session.json status done, setiap workload punya CSV + meta.json berstatus done;
//   - jumlah run per (workload, N, sel) = repetisi; tidak ada error; pageHidden selalu false;
//     clockCheckFailed tidak pernah true;
//   - semua run konvergen dan jumlah iterasi sama antar sel (per workload, N);
//   - workload full: tabel SPSS identik (tablesIdenticalToD = true);
//   - |ΔB| dan |ΔS.E.| < 1e-8 antar sel, sesi, dan browser (acuan: run D-warm pertama sesi pertama);
//   - gitCommit sama di semua sesi dan tanpa -dirty; hash .wasm = ARTIFACT_HASHES.json repo dan
//     wasmHashVerified = true;
//   - versi browser sama di semua sesi browser yang sama;
//   - viewport (innerWidth × innerHeight) dan devicePixelRatio sama di semua batch browser yang
//     sama (tidak disamakan antar browser; lihat EXPERIMENT.md §10);
//   - fokus: visibilityState "visible" di awal dan akhir batch dan jendela browser menjadi
//     foreground OS di awal dan akhir batch (session.json). document.hasFocus() hanya dilaporkan:
//     Firefox di bawah otomasi WebDriver BiDi selalu melaporkan false.
// Ringkasan Markdown (stdout dan <runDir>/validation.md; JSON di validation.json): durasi tiap
// sesi, median computeMs dan e2eMs per sel per sesi, dan sesi yang menyimpang > 25% dari median
// sesi lain browser yang sama. Exit code 1 bila ada pelanggaran.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
export const AGREEMENT_TOL = 1e-8;
export const DEVIATION = 0.25;
const CELL_ORDER = ["A", "B-warm", "B-cold", "C", "D-warm", "D-cold"];
const WASM_KEY = "pkg/statify_logistic_bg.wasm";

/** Parser CSV RFC 4180 (field ber-kutip; userAgent Chrome berisi koma). */
export function parseCsv(text) {
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

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const h = (v.length - 1) / 2;
  return v[Math.floor(h)] + (h - Math.floor(h)) * (v[Math.ceil(h)] - v[Math.floor(h)]);
}

/**
 * Cek satu batch (baris CSV satu workload satu sesi). Mengembalikan daftar pelanggaran (string).
 * expected = { repetitions, sizes, cells }.
 */
export function checkBatchRows(rows, workload, expected) {
  const v = [];
  const at = (r) => `N=${r.N} cell=${r.cell} rep=${r.rep}`;
  for (const N of expected.sizes) {
    for (const cell of expected.cells) {
      const n = rows.filter((r) => Number(r.N) === N && r.cell === cell).length;
      if (n !== expected.repetitions) v.push(`${workload}: N=${N} cell=${cell} has ${n} runs, expected ${expected.repetitions}`);
    }
  }
  const extra = rows.filter((r) => !expected.sizes.includes(Number(r.N)) || !expected.cells.includes(r.cell));
  if (extra.length) v.push(`${workload}: ${extra.length} run(s) outside the expected sizes/cells`);
  for (const r of rows) {
    if (r.error) v.push(`${workload}: error at ${at(r)}: ${r.error}`);
    if (r.pageHidden !== "false") v.push(`${workload}: pageHidden=${r.pageHidden} at ${at(r)}`);
    if (r.clockCheckFailed === "true") v.push(`${workload}: clockCheckFailed at ${at(r)}`);
    if (r.converged !== "true") v.push(`${workload}: not converged at ${at(r)}`);
    if (workload === "full" && r.tablesIdenticalToD !== "true") v.push(`${workload}: SPSS tables differ from D-warm at ${at(r)}`);
  }
  for (const N of expected.sizes) {
    const its = [...new Set(rows.filter((r) => Number(r.N) === N).map((r) => r.iterations))];
    if (its.length > 1) v.push(`${workload}: N=${N} iterations differ between runs/cells: ${its.join(", ")}`);
  }
  return v;
}

/** Selisih absolut maksimum B_* dan SE_* terhadap baris acuan. */
export function maxCoefDiff(rows, ref) {
  const keys = Object.keys(ref).filter((k) => k.startsWith("B_") || k.startsWith("SE_"));
  let beta = 0;
  let se = 0;
  for (const r of rows) {
    for (const k of keys) {
      const d = Math.abs(Number(r[k]) - Number(ref[k]));
      const target = k.startsWith("B_") ? "beta" : "se";
      if (!(d <= (target === "beta" ? beta : se))) {
        if (target === "beta") beta = d;
        else se = d;
      }
    }
  }
  return { beta, se };
}

function loadSessions(runDir, run) {
  return run.schedule
    .map((s) => ({ ...s, path: join(runDir, s.dir) }))
    .filter((s) => existsSync(join(s.path, "session.json")))
    .map((s) => {
      const session = JSON.parse(readFileSync(join(s.path, "session.json"), "utf8"));
      const batches = {};
      for (const b of session.batches ?? []) {
        if (b.csv && existsSync(join(s.path, b.csv)) && b.meta && existsSync(join(s.path, b.meta))) {
          batches[b.workload] = {
            info: b,
            rows: parseCsv(readFileSync(join(s.path, b.csv), "utf8")),
            meta: JSON.parse(readFileSync(join(s.path, b.meta), "utf8")),
          };
        }
      }
      return { ...s, session, batches };
    });
}

export function validateRun(runDir) {
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const cfg = run.config;
  const cells = cfg.lifecycle === "interleaved" ? CELL_ORDER : CELL_ORDER.filter((c) => !c.endsWith(cfg.lifecycle === "per-run" ? "-warm" : "-cold"));
  const expected = { repetitions: cfg.repetitions, sizes: cfg.sizes, cells };
  const sessions = loadSessions(runDir, run);
  const missing = run.schedule.filter((s) => !sessions.some((x) => x.id === s.id)).map((s) => s.id);
  const violations = [];
  const info = [];
  if (missing.length) violations.push(`run: sessions without output: ${missing.join(", ")}`);
  const artifacts = JSON.parse(readFileSync(join(frontend, "public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json"), "utf8"));
  const expectedWasm = artifacts.files[WASM_KEY].sha256;

  for (const s of sessions) {
    const sv = (msg) => violations.push(`${s.id}: ${msg}`);
    if (s.session.status !== "done") sv(`session status ${s.session.status}${s.session.error ? ` (${s.session.error.split("\n")[0]})` : ""}`);
    for (const workload of cfg.workloads) {
      const b = s.batches[workload];
      if (!b) {
        sv(`${workload}: CSV/meta.json missing`);
        continue;
      }
      if (b.meta.status !== "done") sv(`${workload}: batch status ${b.meta.status}`);
      for (const msg of checkBatchRows(b.rows, workload, expected)) sv(msg);
      const env = b.meta.environment ?? {};
      if (!env.gitCommit || env.gitCommit.endsWith("-dirty")) sv(`${workload}: gitCommit ${env.gitCommit} (missing or dirty)`);
      if (env.artifactHashes?.[WASM_KEY]?.sha256 !== expectedWasm) sv(`${workload}: wasm SHA-256 ${env.artifactHashes?.[WASM_KEY]?.sha256} ≠ ${expectedWasm}`);
      if (env.wasmHashVerified !== true) sv(`${workload}: wasmHashVerified = ${env.wasmHashVerified}`);
      if (env.visibilityStart !== "visible" || env.visibilityEnd !== "visible") sv(`${workload}: visibility ${env.visibilityStart}/${env.visibilityEnd}`);
      const fgBefore = b.info.windowBefore?.foreground;
      const fgAfter = b.info.windowAfter?.foreground;
      if (fgBefore !== undefined || fgAfter !== undefined) {
        if (fgBefore !== true || fgAfter !== true) sv(`${workload}: browser window not the OS foreground window (before ${fgBefore}, after ${fgAfter})`);
      }
      if (env.hasFocusStart !== true || env.hasFocusEnd !== true) {
        info.push(`${s.id} ${workload}: document.hasFocus() ${env.hasFocusStart}/${env.hasFocusEnd} (${env.browserName}; informasi, bukan pelanggaran)`);
      }
      if (b.meta.session?.id !== s.id) sv(`${workload}: meta.session.id ${b.meta.session?.id} ≠ ${s.id}`);
    }
  }

  // Konsistensi antar sesi: gitCommit, versi browser per browser
  const commits = [...new Set(sessions.flatMap((s) => Object.values(s.batches).map((b) => b.meta.environment?.gitCommit)))];
  if (commits.length > 1) violations.push(`run: gitCommit differs between sessions: ${commits.join(", ")}`);
  const versions = {};
  for (const s of sessions) {
    for (const b of Object.values(s.batches)) {
      (versions[s.browser] ??= new Set()).add(b.meta.environment?.browserVersion);
    }
  }
  for (const [browser, vs] of Object.entries(versions)) {
    if (vs.size > 1) violations.push(`run: ${browser} version differs between sessions: ${[...vs].join(", ")}`);
  }
  // Viewport dan DPR tidak disamakan antar browser (jendela dimaksimalkan, EXPERIMENT.md §10),
  // jadi harus konstan di semua batch browser yang sama
  const viewports = viewportsByBrowser(sessions);
  for (const [browser, groups] of Object.entries(viewports)) {
    if (groups.length > 1) {
      violations.push(`run: ${browser} viewport differs between batches: ${groups.map((g) => `${g.viewport} (${g.batches.join(", ")})`).join("; ")}`);
    }
  }

  // Kesepakatan koefisien antar sel, sesi, dan browser
  const agreement = [];
  for (const workload of cfg.workloads) {
    for (const N of cfg.sizes) {
      const all = sessions.flatMap((s) => (s.batches[workload]?.rows ?? []).filter((r) => Number(r.N) === N && !r.error));
      const ref = sessions.map((s) => s.batches[workload]?.rows.find((r) => Number(r.N) === N && r.cell === "D-warm" && !r.error)).find(Boolean);
      if (!ref) continue;
      const d = maxCoefDiff(all, ref);
      agreement.push({ workload, N, maxAbsDiffBeta: d.beta, maxAbsDiffSe: d.se, runs: all.length });
      if (!(d.beta < AGREEMENT_TOL && d.se < AGREEMENT_TOL)) {
        violations.push(`run: ${workload} N=${N}: max |ΔB| ${d.beta.toExponential(2)}, max |ΔS.E.| ${d.se.toExponential(2)} across cells/sessions/browsers (≥ ${AGREEMENT_TOL})`);
      }
    }
  }

  // Median per sel per sesi dan penyimpangan > 25% dari median sesi lain browser yang sama
  const medians = [];
  for (const s of sessions) {
    for (const workload of cfg.workloads) {
      for (const N of cfg.sizes) {
        for (const cell of cells) {
          const rs = (s.batches[workload]?.rows ?? []).filter((r) => Number(r.N) === N && r.cell === cell && !r.error);
          medians.push({
            session: s.id,
            browser: s.browser,
            role: s.role,
            workload,
            N,
            cell,
            computeMs: median(rs.map((r) => Number(r.computeMs))),
            e2eMs: median(rs.map((r) => Number(r.e2eMs))),
          });
        }
      }
    }
  }
  const deviations = [];
  for (const m of medians) {
    for (const metric of ["computeMs", "e2eMs"]) {
      const peers = medians.filter(
        (x) => x.browser === m.browser && x.role === m.role && x.workload === m.workload && x.N === m.N && x.cell === m.cell && x.session !== m.session
      );
      if (peers.length < 2) continue;
      const ref = median(peers.map((x) => x[metric]));
      const ratio = m[metric] / ref;
      if (Number.isFinite(ratio) && Math.abs(Math.log(ratio)) > Math.log(1 + DEVIATION)) {
        deviations.push({ ...m, metric, value: m[metric], peersMedian: ref, ratio });
      }
    }
  }
  return { runId: run.runId, config: cfg, sessions, violations, info, agreement, medians, deviations, cells, viewports };
}

/** "innerWidth×innerHeight @DPR" dari meta.environment (CSS px; DPR 3 desimal). */
export function viewportLabel(env) {
  const dpr = Number(env?.devicePixelRatio);
  return `${env?.innerWidth ?? "?"}×${env?.innerHeight ?? "?"} @${Number.isFinite(dpr) ? Number(dpr.toFixed(3)) : "?"}`;
}

/** Per browser: nilai viewport berbeda beserta batch ("<sesi> <workload>") yang memakainya. */
export function viewportsByBrowser(sessions) {
  const out = {};
  for (const s of sessions) {
    for (const [workload, b] of Object.entries(s.batches)) {
      const groups = (out[s.browser] ??= []);
      const viewport = viewportLabel(b.meta.environment);
      let g = groups.find((x) => x.viewport === viewport);
      if (!g) groups.push((g = { viewport, batches: [] }));
      g.batches.push(`${s.id} ${workload}`);
    }
  }
  return out;
}

const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const dur = (ms) => (Number.isFinite(ms) ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s` : "–");

export function renderMarkdown(r) {
  const lines = [`# Validasi run ${r.runId}`, ""];
  lines.push(`Hasil: **${r.violations.length === 0 ? "LULUS" : `${r.violations.length} pelanggaran`}**`, "");
  lines.push(
    "## Sesi",
    "",
    "| sesi | browser | versi | peran | status | durasi | impor | viewport (CSS px @DPR) | urutan workload | urutan N (core / full) |",
    "|---|---|---|---|---|---:|---:|---|---|---|"
  );
  for (const s of r.sessions) {
    const order = (w) => s.batches[w]?.meta.sizeOrderUsed?.join("→") ?? "–";
    const viewport = [...new Set(Object.values(s.batches).map((b) => viewportLabel(b.meta.environment)))].join(", ") || "–";
    lines.push(
      `| ${s.id} | ${s.browser} | ${s.session.browserVersion ?? "–"} | ${s.role} | ${s.session.status} | ${dur(s.session.durationMs)} | ${dur(s.session.importMs)} | ${viewport} | ${(s.session.workloadOrder ?? []).join(" → ")} | ${order("core")} / ${order("full")} |`
    );
  }
  lines.push("", "## Kesepakatan koefisien antar sel, sesi, dan browser", "", "| workload | N | runs | max abs ΔB | max abs ΔS.E. |", "|---|---:|---:|---:|---:|");
  for (const a of r.agreement) lines.push(`| ${a.workload} | ${a.N} | ${a.runs} | ${a.maxAbsDiffBeta.toExponential(2)} | ${a.maxAbsDiffSe.toExponential(2)} |`);
  for (const workload of r.config.workloads) {
    for (const N of r.config.sizes) {
      lines.push("", `## Median computeMs / e2eMs (ms): ${workload}, N = ${N}`, "", `| sesi | ${r.cells.join(" | ")} |`, `|---|${r.cells.map(() => "---:").join("|")}|`);
      for (const s of r.sessions) {
        const cellsText = r.cells.map((cell) => {
          const m = r.medians.find((x) => x.session === s.id && x.workload === workload && x.N === N && x.cell === cell);
          const flag = r.deviations.some((d) => d.session === s.id && d.workload === workload && d.N === N && d.cell === cell) ? " ⚠" : "";
          return m ? `${f(m.computeMs)} / ${f(m.e2eMs)}${flag}` : "–";
        });
        lines.push(`| ${s.id} | ${cellsText.join(" | ")} |`);
      }
    }
  }
  if (r.deviations.length) {
    lines.push("", `## Sesi menyimpang (> ${DEVIATION * 100}% dari median sesi lain browser dan peran yang sama)`, "");
    for (const d of r.deviations) lines.push(`- ${d.session} ${d.workload} N=${d.N} ${d.cell} ${d.metric}: ${f(d.value)} ms vs ${f(d.peersMedian)} ms (×${f(d.ratio)})`);
  }
  if (r.info.length) {
    lines.push("", "## Informasi", "");
    for (const i of [...new Set(r.info)]) lines.push(`- ${i}`);
  }
  lines.push("", "## Pelanggaran", "");
  if (r.violations.length === 0) lines.push("Tidak ada.");
  for (const v of r.violations.slice(0, 200)) lines.push(`- ${v}`);
  if (r.violations.length > 200) lines.push(`- … dan ${r.violations.length - 200} lainnya (lihat validation.json)`);
  return lines.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const runDir = resolve(args.find((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1)) ?? "");
  if (!existsSync(join(runDir, "run.json"))) {
    console.error("Usage: node scripts/validateRun.mjs <benchmark-results/<runId>> [--out file.md]");
    process.exit(2);
  }
  const r = validateRun(runDir);
  const md = renderMarkdown(r);
  writeFileSync(outIdx >= 0 ? resolve(args[outIdx + 1]) : join(runDir, "validation.md"), md);
  writeFileSync(
    join(runDir, "validation.json"),
    JSON.stringify(
      {
        runId: r.runId,
        passed: r.violations.length === 0,
        violations: r.violations,
        info: [...new Set(r.info)],
        agreement: r.agreement,
        deviations: r.deviations,
        viewports: r.viewports,
        sessions: r.sessions.map((s) => ({ id: s.id, browser: s.browser, role: s.role, status: s.session.status, durationMs: s.session.durationMs })),
        medians: r.medians,
      },
      null,
      2
    ) + "\n"
  );
  process.stdout.write(md);
  if (r.violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
