// Pembanding native workload "core" (eksperimen v2, Tugas 7), lintas-OS.
//
//   node scripts/runNative.mjs <runDir> [--invocations 10] [--pause-sec 10] [--warmup 5]
//                              [--repetitions 30] [--seed-base 5000] [--skip-build]
//
// <runDir> = benchmark-results/<runId> dari tests/experiment/orchestrate.mjs (berisi design/).
// 1. `cargo build --release --locked --bin irls_native_bench` di crate BinaryLogistic/rust dengan
//    toolchain terkunci (rust-toolchain.toml); target default host (x86-64 tanpa
//    `-C target-cpu=native`: RUSTFLAGS/CARGO_BUILD_RUSTFLAGS dari environment dikosongkan).
// 2. Mencatat `rustc -Vv`, `cargo -V`, model CPU, dan SHA-256 biner.
// 3. Menjalankan biner sebagai proses terpisah ("invocation") sebanyak --invocations kali dengan
//    jeda --pause-sec; urutan N tiap invocation diacak dengan seed = seed-base + k.
//    Hasil: <runDir>/native/invocation-<kk>.csv dan native.json.
// 4. Cek: β dan SE native = sel D-warm (run sukses pertama tiap N) dari sesi pilot (atau sesi ukur
//    pertama tiap browser bila tidak ada pilot), |Δ| ≤ 1e-12 · max(1, |nilai|). Exit 1 bila gagal.
//
// Native hanya titik pembanding (core, kondisi warm), bukan faktor eksperimen (EXPERIMENT.md).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const crate = join(frontend, "components/Modals/Analyze/Regression/BinaryLogistic/rust");
const TOL = 1e-12;

function parseArgs(argv) {
  const a = { runDir: null, invocations: 10, pauseSec: 10, warmup: 5, repetitions: 30, seedBase: 5000, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const num = () => Number(argv[++i]);
    if (k === "--invocations") a.invocations = num();
    else if (k === "--pause-sec") a.pauseSec = num();
    else if (k === "--warmup") a.warmup = num();
    else if (k === "--repetitions") a.repetitions = num();
    else if (k === "--seed-base") a.seedBase = num();
    else if (k === "--skip-build") a.skipBuild = true;
    else if (!k.startsWith("--") && !a.runDir) a.runDir = resolve(k);
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.runDir) throw new Error("Usage: node scripts/runNative.mjs <runDir> [--invocations 10] [--pause-sec 10]");
  return a;
}

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

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scaled = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

function cleanEnv() {
  const env = { ...process.env };
  const removed = {};
  for (const k of ["RUSTFLAGS", "CARGO_BUILD_RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_BUILD_TARGET"]) {
    if (env[k] !== undefined) {
      removed[k] = env[k];
      delete env[k];
    }
  }
  return { env, removed };
}

/** Sesi acuan: pilot bila ada, selain itu sesi ukur pertama tiap browser. */
function referenceSessions(runDir) {
  const out = [];
  for (const browser of readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !["design", "native"].includes(d.name))) {
    const dirs = readdirSync(join(runDir, browser.name)).filter((d) => /^(pilot|measure)-\d+$/.test(d)).sort();
    const pick = dirs.find((d) => d.startsWith("pilot-")) ?? dirs.find((d) => d.startsWith("measure-"));
    if (pick) out.push({ label: `${browser.name}/${pick}`, dir: join(runDir, browser.name, pick) });
  }
  return out;
}

/** β/SE run sukses pertama sel D-warm per N dari CSV batch core sebuah sesi. */
function dWarmReference(sessionDir) {
  const csvFile = readdirSync(sessionDir).find((f) => /^batch-\d+\.csv$/.test(f));
  if (!csvFile) return null;
  const byN = new Map();
  for (const r of parseCsv(readFileSync(join(sessionDir, csvFile), "utf8"))) {
    if (r.cell === "D-warm" && !r.error && !byN.has(Number(r.N))) byN.set(Number(r.N), r);
  }
  return byN;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const designDir = join(a.runDir, "design");
  if (!existsSync(designDir)) throw new Error(`${designDir} not found: run the orchestrator first (it exports design/).`);
  const nativeDir = join(a.runDir, "native");
  mkdirSync(nativeDir, { recursive: true });
  const { env, removed } = cleanEnv();

  // 1. Build
  if (!a.skipBuild) {
    console.log("cargo build --release --locked --bin irls_native_bench");
    const b = spawnSync("cargo", ["build", "--release", "--locked", "--bin", "irls_native_bench"], { cwd: crate, env, stdio: "inherit" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  const exe = join(crate, "target/release", process.platform === "win32" ? "irls_native_bench.exe" : "irls_native_bench");
  const tool = (cmd, args) => execFileSync(cmd, args, { cwd: crate, env, encoding: "utf8" }).trim();
  const meta = {
    description: "Pembanding native irls_core (workload core, kondisi warm); bukan faktor eksperimen.",
    startedAt: new Date().toISOString(),
    rustc: tool("rustc", ["-Vv"]),
    cargo: tool("cargo", ["-V"]),
    rustflagsRemovedFromEnv: removed,
    profile: "release (Cargo.toml default: opt-level 3, tanpa LTO), target host default tanpa target-cpu=native",
    host: { cpu: os.cpus()[0]?.model ?? null, logicalCpus: os.cpus().length, osRelease: os.release(), platform: process.platform },
    binary: { path: exe, sha256: sha256(readFileSync(exe)) },
    settings: { invocations: a.invocations, pauseSec: a.pauseSec, warmup: a.warmup, repetitions: a.repetitions, seedBase: a.seedBase },
    invocations: [],
  };
  console.log(meta.rustc.split("\n")[0], "|", meta.host.cpu);

  // 2. Invocation = proses terpisah
  for (let k = 1; k <= a.invocations; k++) {
    const out = join(nativeDir, `invocation-${String(k).padStart(2, "0")}.csv`);
    const seed = a.seedBase + k;
    const t0 = Date.now();
    const r = spawnSync(
      exe,
      ["--design-dir", designDir, "--invocation", String(k), "--seed", String(seed), "--warmup", String(a.warmup), "--repetitions", String(a.repetitions), "--out", out],
      { env, encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(`invocation ${k} failed: ${r.stderr}`);
    meta.invocations.push({ k, seed, csv: `invocation-${String(k).padStart(2, "0")}.csv`, wallMs: Date.now() - t0 });
    console.log(`invocation ${k}/${a.invocations}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (k < a.invocations && a.pauseSec > 0) await sleep(a.pauseSec * 1000);
  }

  // 3. Cek terhadap D-warm sesi acuan
  const native = meta.invocations.flatMap((inv) => parseCsv(readFileSync(join(nativeDir, inv.csv), "utf8")));
  const names = Object.keys(native[0]).filter((k) => k.startsWith("beta_")).map((k) => k.slice(5));
  const checks = [];
  for (const ref of referenceSessions(a.runDir)) {
    const byN = dWarmReference(ref.dir);
    if (!byN) continue;
    for (const N of [...new Set(native.map((r) => Number(r.N)))].sort((x, y) => x - y)) {
      const d = byN.get(N);
      if (!d) {
        checks.push({ reference: ref.label, N, passed: false, note: "no D-warm run in the reference session" });
        continue;
      }
      let maxBeta = 0;
      let maxSe = 0;
      for (const r of native.filter((x) => Number(x.N) === N)) {
        for (const name of names) {
          maxBeta = Math.max(maxBeta, scaled(Number(r[`beta_${name}`]), Number(d[`B_${name}`])));
          maxSe = Math.max(maxSe, scaled(Number(r[`se_${name}`]), Number(d[`SE_${name}`])));
        }
      }
      checks.push({ reference: ref.label, N, maxScaledDiffBeta: maxBeta, maxScaledDiffSe: maxSe, passed: maxBeta <= TOL && maxSe <= TOL });
    }
  }
  meta.check = { tolerance: `|Δ| ≤ ${TOL} · max(1, |value|)`, results: checks, passed: checks.length > 0 && checks.every((c) => c.passed) };
  meta.finishedAt = new Date().toISOString();
  writeFileSync(join(nativeDir, "native.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`\nNative vs D-warm (${meta.check.tolerance})`);
  console.log("| reference | N | max scaled Δβ | max scaled ΔSE | pass |\n|---|---:|---:|---:|---|");
  for (const c of checks) {
    console.log(
      `| ${c.reference} | ${c.N} | ${c.maxScaledDiffBeta?.toExponential(2) ?? "–"} | ${c.maxScaledDiffSe?.toExponential(2) ?? "–"} | ${c.passed ? "PASS" : `FAIL${c.note ? ` (${c.note})` : ""}`} |`
    );
  }
  const med = (v) => {
    const s = [...v].sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)] / 2 + s[Math.ceil((s.length - 1) / 2)] / 2;
  };
  console.log("\n| N | median computeMs native |\n|---:|---:|");
  for (const N of [...new Set(native.map((r) => Number(r.N)))].sort((x, y) => x - y)) {
    console.log(`| ${N} | ${med(native.filter((r) => Number(r.N) === N).map((r) => Number(r.computeMs))).toFixed(3)} |`);
  }
  console.log(`\nOutput: ${nativeDir}`);
  if (!meta.check.passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
