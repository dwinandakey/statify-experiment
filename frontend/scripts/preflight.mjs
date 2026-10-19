// Preflight hari-H eksperimen v2 (Tugas 9). HANYA MEMBACA: skrip ini tidak mengubah pengaturan
// sistem apa pun. Setiap cek dilaporkan HIJAU (OK), KUNING (peringatan), atau MERAH (jangan mulai).
//
//   npm run bench:preflight                         config tests/experiment/bench.v2.json
//   npm run bench:preflight -- --dry                config mini Tugas 8 (bench.v2.mini.json)
//   npm run bench:preflight -- --config <file> --out <file.json>
//
// Cek:
// - Daya: laptop tercolok charger (Win32_Battery.BatteryStatus; tanpa baterai = AC). Skema daya
//   aktif (powercfg /getactivescheme) dicetak; mode daya Windows (overlay AC) harus Best
//   performance seperti protokol EXPERIMENT.md §9a, selain itu kuning.
// - Versi browser: ProductVersion chrome.exe/firefox.exe pada path di config (di luar Windows:
//   `<exe> --version`), disimpan di file JSON untuk dibandingkan lagi setelah run (benchDay.mjs).
// - Updater: service GoogleUpdater*/gupdate* kuning bila Running atau Automatic; scheduled task
//   GoogleUpdater*/GoogleUpdateTask* dan Firefox Background Update* kuning bila Ready/Running.
//   Tanpa hak admin, task tingkat sistem bisa tidak terlihat.
// - Repo: git status bersih (file terlacak berubah = merah, untracked = kuning); production build
//   ada, .next/EXPERIMENT_BUILD.json cocok dengan BUILD_ID, gitCommit build tidak -dirty dan sama
//   dengan HEAD; ARTIFACT_HASHES.json cocok dengan file (hashArtifacts.mjs --check) dan hash .wasm
//   = biner yang diukur; SHA-256 dataset = manifest.
// - Server: bila "startServer": true, orkestrator menyalakan `next start` sendiri dan gagal bila
//   port sudah dipakai. Preflight memeriksa port itu kosong, menyalakan server sementara dengan
//   perintah yang sama, lalu mematikannya lagi. /dashboard/data harus 200 dengan COOP same-origin
//   dan COEP require-corp (crossOriginIsolated = true), dan .wasm yang dilayani = biner yang diukur.
// - Proses pengganggu (kuning): VS Code, OneDrive, Teams, Discord, browser lain.
// - Ruang disk kosong di drive output ≥ 5 GB.
// Hasil dicetak dan disimpan ke <outputDir>/preflight-<waktu UTC>.json. Exit code 1 bila ada cek
// merah. Cek khusus Windows (daya, updater) berstatus kuning "tidak dicek" di OS lain.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, portInUse, stamp, startServer, stopServer } from "../../tests/experiment/orchestrate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, "..");
const REPO = resolve(FRONTEND, "..");
export const REAL_CONFIG = "tests/experiment/bench.v2.json";
export const MINI_CONFIG = "tests/experiment/bench.v2.mini.json";
/** Biner wasm yang diukur (ATURAN KERAS 2; sama dengan test binaryLogisticExperiment.artifacts). */
export const MEASURED_WASM_SHA256 = "3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d";
export const MIN_FREE_GB = 5;
const WASM_KEY = "pkg/statify_logistic_bg.wasm";
const WASM_PATH = "/workers/Regression/BinaryExperiment/pkg/statify_logistic_bg.wasm";
const APP_PATH = "/dashboard/data";
const BUILD_FIX = "jalankan `npm run build:experiment`";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
/** Path relatif terhadap root repo (pemisah /), atau absolut bila di luar repo. */
const rel = (p) => {
  const r = relative(REPO, p);
  return r.startsWith("..") || resolve(r) === r ? p : r.split("\\").join("/");
};
const lastLine = (text) => String(text ?? "").trim().split(/\r?\n/).at(-1) ?? "";

/** Nomor versi pertama di teks: "Chrome/155.0.8059.80/@43a…" → "155.0.8059.80", "Mozilla Firefox 158.0" → "158.0". */
export function versionNumber(text) {
  const m = /(\d+(?:\.\d+)+)/.exec(String(text ?? ""));
  return m ? m[1] : null;
}

// --- Evaluasi (fungsi murni; diuji Jest) ---

const RANK = { ok: 0, warn: 1, fail: 2 };
const worst = (statuses) => statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

const BATTERY_STATUS = {
  1: ["baterai, discharging", "fail"],
  2: ["AC", "ok"],
  3: ["terisi penuh", "ok"],
  4: ["baterai lemah", "fail"],
  5: ["baterai kritis", "fail"],
  6: ["mengisi", "ok"],
  7: ["mengisi, tinggi", "ok"],
  8: ["mengisi, rendah", "ok"],
  9: ["mengisi, kritis", "ok"],
  10: ["tidak terdefinisi", "warn"],
  11: ["terisi sebagian", "warn"],
};

/** Win32_Battery ([{ BatteryStatus, EstimatedChargeRemaining }]) → { status, detail }. */
export function evaluateBattery(batteries) {
  if (!batteries?.length) return { status: "ok", detail: "tanpa baterai (daya AC)" };
  const parts = batteries.map((b) => {
    const [label, status] = BATTERY_STATUS[b.BatteryStatus] ?? ["tidak dikenal", "warn"];
    const charge = b.EstimatedChargeRemaining == null ? "" : `, ${b.EstimatedChargeRemaining}%`;
    return { status, text: `BatteryStatus ${b.BatteryStatus ?? "?"} (${label}${charge})` };
  });
  const status = worst(parts.map((p) => p.status));
  const head = { ok: "tercolok charger", warn: "status charger tidak pasti", fail: "TIDAK tercolok charger" }[status];
  return { status, detail: `${head}: ${parts.map((p) => p.text).join("; ")}` };
}

/** GUID overlay mode daya Windows (Settings > System > Power > Power mode). */
export const POWER_MODES = {
  "961cc777-2547-4f9d-8174-7d86181b8a7a": "Best power efficiency",
  "00000000-0000-0000-0000-000000000000": "Balanced",
  "ded574b5-45a0-4f42-8737-46345c09c238": "Best performance",
};

/** Keluaran `powercfg /getactivescheme` + ActiveOverlayAcPowerScheme → { status, detail }. */
export function evaluatePowerMode(activeScheme, overlayAc) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)/i.exec(activeScheme ?? "");
  const scheme = m ? `skema "${m[2]}" (${m[1]})` : `skema: ${String(activeScheme ?? "").trim() || "?"}`;
  const guid = String(overlayAc || "00000000-0000-0000-0000-000000000000").toLowerCase();
  const mode = POWER_MODES[guid] ?? `overlay ${guid}`;
  const status = mode === "Best performance" ? "ok" : "warn";
  return { status, detail: `${scheme}; mode daya (AC): ${mode}${status === "ok" ? "" : " (protokol: Best performance)"}` };
}

/** Service [{ Name, Status, StartType }] dan task [{ TaskPath, TaskName, State }] updater → { status, detail }. */
export function evaluateUpdaters(services, tasks, { isAdmin = false } = {}) {
  const active = [];
  const idle = [];
  for (const s of services ?? []) {
    (s.Status === "Running" || s.StartType === "Automatic" ? active : idle).push(`service ${s.Name} (${s.Status}, ${s.StartType})`);
  }
  for (const t of tasks ?? []) {
    (t.State === "Ready" || t.State === "Running" ? active : idle).push(`task ${t.TaskPath ?? ""}${t.TaskName} (${t.State})`);
  }
  const note = isAdmin ? "" : " Tanpa hak admin, task updater tingkat sistem bisa tidak terlihat.";
  if (active.length) {
    return {
      status: "warn",
      detail: `bisa memperbarui browser di tengah run: ${active.join("; ")}.${note} Versi browser dibandingkan lagi setelah run.`,
    };
  }
  return { status: "ok", detail: `${idle.length ? idle.join("; ") : "tidak ada service/task updater yang aktif"}.${note}` };
}

/** Label dan nama proses (tanpa .exe, huruf kecil) yang mengganggu sesi ukur. */
export const DISTURBING = [
  ["VS Code", ["code"]],
  ["OneDrive", ["onedrive"]],
  ["Microsoft Teams", ["ms-teams", "teams", "teams-for-linux"]],
  ["Discord", ["discord"]],
  ["Google Chrome", ["chrome"]],
  ["Firefox", ["firefox", "firefox-bin"]],
  ["Microsoft Edge", ["msedge"]],
  ["Brave", ["brave"]],
  ["Opera", ["opera"]],
  ["Vivaldi", ["vivaldi"]],
];

/** Nama proses (Get-Process atau ps; akhiran .exe opsional) → { status, detail }. */
export function evaluateProcesses(names) {
  const counts = new Map();
  for (const n of names ?? []) {
    const base = String(n).toLowerCase().replace(/\.exe$/, "");
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const found = DISTURBING.flatMap(([label, keys]) => {
    const c = keys.reduce((a, k) => a + (counts.get(k) ?? 0), 0);
    return c ? [`${label} (${c} proses)`] : [];
  });
  return found.length
    ? { status: "warn", detail: `berjalan: ${found.join(", ")}. Tutup sebelum sesi; orkestrator meluncurkan browser sendiri.` }
    : { status: "ok", detail: "tidak ada VS Code, OneDrive, Teams, Discord, atau browser lain" };
}

/** `git status --porcelain` → { status, detail }: file terlacak berubah = merah, untracked saja = kuning. */
export function evaluateGitStatus(porcelain) {
  const lines = String(porcelain ?? "").split(/\r?\n/).filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith("??"));
  const tracked = lines.filter((l) => !l.startsWith("??"));
  const list = (ls) => ls.slice(0, 8).map((l) => l.slice(3)).join(", ") + (ls.length > 8 ? `, … (+${ls.length - 8})` : "");
  if (tracked.length) {
    const hint = tracked.some((l) => l.endsWith("frontend/next-env.d.ts")) ? " (next-env.d.ts ditulis ulang Next: git restore frontend/next-env.d.ts)" : "";
    return { status: "fail", detail: `file terlacak berubah: ${list(tracked)}${hint}` };
  }
  if (untracked.length) return { status: "warn", detail: `bersih, tetapi ada file untracked: ${list(untracked)}` };
  return { status: "ok", detail: "bersih" };
}

/** BUILD_ID, .next/EXPERIMENT_BUILD.json, dan HEAD → { status, detail }. */
export function evaluateBuild({ buildId, info, head, describe }) {
  if (!buildId) return { status: "fail", detail: `tidak ada production build (.next/BUILD_ID); ${BUILD_FIX}` };
  if (!info) return { status: "fail", detail: `.next/EXPERIMENT_BUILD.json tidak ada (build lama atau bukan dari build:experiment); ${BUILD_FIX}` };
  if (info.nextBuildId !== buildId) {
    return { status: "fail", detail: `BUILD_ID ${buildId} ≠ ${info.nextBuildId} di EXPERIMENT_BUILD.json (.next ditimpa build lain); ${BUILD_FIX}` };
  }
  if (!info.gitCommit || info.gitCommit.endsWith("-dirty")) {
    return { status: "fail", detail: `gitCommit build ${info.gitCommit ?? "?"} (dirty); ${BUILD_FIX} dari working tree bersih` };
  }
  if (info.gitHead !== head) return { status: "fail", detail: `build dari ${info.gitCommit}, HEAD sekarang ${describe}; ${BUILD_FIX}` };
  return { status: "ok", detail: `${info.gitCommit} = HEAD (BUILD_ID ${buildId}, dibuat ${info.builtAt})` };
}

/** Keluaran hashArtifacts.mjs --check dan hash .wasm di ARTIFACT_HASHES.json → { status, detail }. */
export function evaluateArtifacts({ checkStatus, checkOutput, wasmSha256 }) {
  if (checkStatus !== 0) return { status: "fail", detail: `ARTIFACT_HASHES.json tidak cocok dengan file: ${lastLine(checkOutput)}` };
  if (wasmSha256 !== MEASURED_WASM_SHA256) {
    return { status: "fail", detail: `hash .wasm di ARTIFACT_HASHES.json (${String(wasmSha256).slice(0, 12)}…) bukan biner yang diukur` };
  }
  return { status: "ok", detail: `cocok dengan file; .wasm = biner yang diukur (${MEASURED_WASM_SHA256.slice(0, 8)}…)` };
}

/** Respons /dashboard/data dan .wasm → { status, detail }. */
export function evaluateServer({ pageStatus, coop, coep, wasmStatus, wasmSha256 }) {
  const problems = [];
  if (pageStatus !== 200) problems.push(`${APP_PATH} → HTTP ${pageStatus}`);
  if (coop !== "same-origin") problems.push(`COOP ${coop ?? "tidak ada"} (harus same-origin)`);
  if (coep !== "require-corp" && coep !== "credentialless") problems.push(`COEP ${coep ?? "tidak ada"} (harus require-corp)`);
  if (wasmStatus !== 200) problems.push(`.wasm → HTTP ${wasmStatus}`);
  else if (wasmSha256 !== MEASURED_WASM_SHA256) problems.push(`.wasm yang dilayani (${String(wasmSha256).slice(0, 12)}…) bukan biner yang diukur`);
  if (problems.length) return { status: "fail", detail: problems.join("; ") };
  return {
    status: "ok",
    detail: `${APP_PATH} 200, COOP ${coop}, COEP ${coep} (crossOriginIsolated); .wasm yang dilayani = biner yang diukur`,
  };
}

/** Byte kosong → { status, detail } (GB = 1024³ byte, seperti Explorer). */
export function evaluateDisk(freeBytes, where) {
  const gb = freeBytes / 1024 ** 3;
  return { status: gb >= MIN_FREE_GB ? "ok" : "fail", detail: `${gb.toFixed(1)} GB kosong di ${where} (minimum ${MIN_FREE_GB} GB)` };
}

// --- Pengumpulan data (baca saja) ---

/** Satu panggilan PowerShell untuk semua data khusus Windows. */
function probeWindows(browserPaths) {
  const paths = browserPaths.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = [ordered]@{}
$o.battery = @(Get-CimInstance Win32_Battery | ForEach-Object { [ordered]@{ BatteryStatus = $_.BatteryStatus; EstimatedChargeRemaining = $_.EstimatedChargeRemaining } })
$o.activeScheme = (powercfg /getactivescheme | Out-String).Trim()
$o.overlayAc = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes').ActiveOverlayAcPowerScheme
$o.services = @(Get-Service -Name 'GoogleUpdater*','gupdate*' | ForEach-Object { [ordered]@{ Name = $_.Name; Status = "$($_.Status)"; StartType = "$($_.StartType)" } })
$o.tasks = @(Get-ScheduledTask -TaskName 'GoogleUpdater*','GoogleUpdateTask*','Firefox Background Update*' | ForEach-Object { [ordered]@{ TaskPath = $_.TaskPath; TaskName = $_.TaskName; State = "$($_.State)" } })
$o.isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$o.versions = @(@(${paths}) | ForEach-Object { [ordered]@{ path = $_; version = $(if (Test-Path -LiteralPath $_) { (Get-Item -LiteralPath $_).VersionInfo.ProductVersion } else { $null }) } })
$o.processes = @(Get-Process | ForEach-Object { $_.ProcessName })
$o | ConvertTo-Json -Depth 4 -Compress`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out.trim());
}

/** Linux/macOS: versi lewat `<exe> --version`, proses lewat ps. */
function probePosix(browserPaths) {
  const versions = browserPaths.map((path) => {
    try {
      return { path, version: existsSync(path) ? versionNumber(execFileSync(path, ["--version"], { encoding: "utf8", timeout: 30_000 })) : null };
    } catch {
      return { path, version: null };
    }
  });
  let processes = [];
  try {
    processes = execFileSync("ps", ["-eo", "comm="], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // ps tidak ada: daftar proses kosong
  }
  return { versions, processes };
}

async function fetchServer(baseUrl) {
  const page = await fetch(new URL(APP_PATH, baseUrl), { redirect: "manual" });
  await page.arrayBuffer();
  const wasm = await fetch(new URL(WASM_PATH, baseUrl));
  const body = Buffer.from(await wasm.arrayBuffer());
  return {
    pageStatus: page.status,
    coop: page.headers.get("cross-origin-opener-policy"),
    coep: page.headers.get("cross-origin-embedder-policy"),
    wasmStatus: wasm.status,
    wasmSha256: wasm.ok ? sha256(body) : null,
  };
}

async function checkServer(cfg) {
  const unreachable = (err) => ({ status: "fail", detail: `${cfg.baseUrl} tidak bisa diakses: ${err.message}` });
  if (!cfg.startServer) {
    try {
      return evaluateServer(await fetchServer(cfg.baseUrl));
    } catch (err) {
      return unreachable(err);
    }
  }
  const port = new URL(cfg.baseUrl).port;
  if (await portInUse(cfg.baseUrl)) {
    return { status: "fail", detail: `port ${port} sudah dipakai; orkestrator menyalakan next start sendiri di ${cfg.baseUrl}, jadi hentikan server itu` };
  }
  let child;
  try {
    child = await startServer(cfg);
  } catch (err) {
    return { status: "fail", detail: `next start sementara gagal: ${err.message}` };
  }
  const onInt = () => {
    child.kill();
    process.exit(130);
  };
  process.once("SIGINT", onInt);
  let result;
  let freed = false;
  try {
    result = evaluateServer(await fetchServer(cfg.baseUrl));
  } catch (err) {
    result = unreachable(err);
  } finally {
    freed = await stopServer(child, cfg);
    process.removeListener("SIGINT", onInt);
  }
  if (!freed) return { status: "fail", detail: `${result.detail}; server sementara tidak berhenti, port ${port} masih dipakai` };
  return { ...result, detail: `${result.detail} (server sementara di port ${port}, sudah dimatikan)` };
}

// --- Main ---

const COLOR = { ok: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m" };
const LABEL = { ok: "HIJAU ", warn: "KUNING", fail: "MERAH " };

/** Satu baris laporan; warna ANSI hanya bila color. */
export function formatCheck(c, color = false) {
  const tag = `[${LABEL[c.status]}]`;
  return `  ${color ? `${COLOR[c.status]}${tag}\x1b[0m` : tag} ${c.title.padEnd(15)} ${c.detail}`;
}

function parseArgs(argv) {
  const a = { config: null, out: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--config") a.config = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--dry") a.dry = true;
    else throw new Error(`Argumen tidak dikenal: ${k}`);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(REPO, args.config ?? (args.dry ? MINI_CONFIG : REAL_CONFIG));
  const cfg = loadConfig(configPath);
  const color = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR === "1");
  const createdAt = new Date();
  const checks = [];
  const add = (id, title, r, data) => {
    const c = { id, title, status: r.status, detail: r.detail, ...(data === undefined ? {} : { data }) };
    checks.push(c);
    console.log(formatCheck(c, color));
  };
  console.log(`Preflight eksperimen v2 · ${createdAt.toLocaleString("id-ID")} · config ${rel(configPath)}\n`);

  // Daya, browser, updater, proses
  const windows = process.platform === "win32";
  const browserPaths = cfg.browsers.map((b) => b.executablePath);
  const probe = windows ? probeWindows(browserPaths) : probePosix(browserPaths);
  const notChecked = { status: "warn", detail: `tidak dicek di ${process.platform} (khusus Windows)` };
  if (windows) {
    add("power", "Daya", evaluateBattery(probe.battery), { battery: probe.battery });
    add("powerMode", "Mode daya", evaluatePowerMode(probe.activeScheme, probe.overlayAc), { activeScheme: probe.activeScheme, overlayAc: probe.overlayAc });
  } else {
    add("power", "Daya", notChecked);
  }
  const browserVersions = {};
  for (const b of cfg.browsers) {
    const version = probe.versions.find((v) => v.path === b.executablePath)?.version ?? null;
    browserVersions[b.name] = version;
    add(
      `browser-${b.name}`,
      `Browser ${b.name}`,
      version ? { status: "ok", detail: `${version} (${b.executablePath})` } : { status: "fail", detail: `tidak ditemukan atau versi tidak terbaca: ${b.executablePath}` },
      { path: b.executablePath, version }
    );
  }
  if (windows) add("updater", "Updater", evaluateUpdaters(probe.services, probe.tasks, { isAdmin: probe.isAdmin }), { services: probe.services, tasks: probe.tasks });
  else add("updater", "Updater", { status: "warn", detail: `tidak dicek di ${process.platform}; pastikan pembaruan otomatis (paket/snap) tidak berjalan selama run` });
  add("processes", "Proses", evaluateProcesses(probe.processes));

  // Repo: git, build, artefak, dataset
  const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trimEnd();
  const head = git("rev-parse", "HEAD");
  const describe = git("describe", "--always", "--dirty", "--abbrev=8");
  add("git", "Git status", evaluateGitStatus(git("status", "--porcelain")), { head, describe });
  const dist = join(FRONTEND, ".next");
  const buildId = existsSync(join(dist, "BUILD_ID")) ? readFileSync(join(dist, "BUILD_ID"), "utf8").trim() : null;
  let buildInfo = null;
  try {
    buildInfo = existsSync(join(dist, "EXPERIMENT_BUILD.json")) ? JSON.parse(readFileSync(join(dist, "EXPERIMENT_BUILD.json"), "utf8")) : null;
  } catch {
    // file rusak = tidak ada
  }
  add("build", "Build", evaluateBuild({ buildId, info: buildInfo, head, describe }), { buildId, info: buildInfo });
  const hashCheck = spawnSync(process.execPath, [join(here, "hashArtifacts.mjs"), "--check"], { cwd: FRONTEND, encoding: "utf8" });
  const hashesPath = join(FRONTEND, "public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json");
  const wasmSha256 = existsSync(hashesPath) ? JSON.parse(readFileSync(hashesPath, "utf8")).files?.[WASM_KEY]?.sha256 : null;
  add("artifacts", "Artefak", evaluateArtifacts({ checkStatus: hashCheck.status, checkOutput: `${hashCheck.stdout}${hashCheck.stderr}`, wasmSha256 }));
  const datasetPath = resolve(REPO, cfg.datasetPath);
  if (!existsSync(datasetPath)) {
    add("dataset", "Dataset", { status: "fail", detail: `tidak ada: ${cfg.datasetPath}` });
  } else {
    const datasetSha = sha256(readFileSync(datasetPath));
    const manifestPath = datasetPath.replace(/\.csv$/, ".manifest.json");
    const manifestSha = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).output?.sha256 : null;
    add(
      "dataset",
      "Dataset",
      !manifestSha
        ? { status: "warn", detail: `${cfg.datasetPath} tanpa manifest (SHA-256 ${datasetSha.slice(0, 12)}…)` }
        : manifestSha === datasetSha
          ? { status: "ok", detail: `${cfg.datasetPath} = manifest (SHA-256 ${datasetSha.slice(0, 12)}…)` }
          : { status: "fail", detail: `SHA-256 ${cfg.datasetPath} (${datasetSha.slice(0, 12)}…) ≠ manifest (${manifestSha.slice(0, 12)}…)` },
      { sha256: datasetSha }
    );
  }

  // Disk dan server
  const outDir = resolve(REPO, cfg.outputDir);
  const where = existsSync(outDir) ? outDir : REPO;
  const disk = statfsSync(where);
  add("disk", "Disk", evaluateDisk(disk.bavail * disk.bsize, rel(where) || "."));
  add("server", "Server", await checkServer(cfg));

  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.status]++;
  const outFile = args.out ? resolve(args.out) : join(outDir, `preflight-${stamp()}.json`);
  mkdirSync(dirname(outFile), { recursive: true });
  const result = {
    createdAt: createdAt.toISOString(),
    config: rel(configPath),
    host: { platform: process.platform, osRelease: os.release(), cpu: os.cpus()[0]?.model ?? null },
    git: { head, describe },
    browserVersions,
    checks,
    summary,
    passed: summary.fail === 0,
  };
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  const verdict = summary.fail === 0 ? "boleh mulai" : "JANGAN mulai sesi: perbaiki cek merah";
  console.log(`\nHasil: ${summary.ok} hijau, ${summary.warn} kuning, ${summary.fail} merah → ${verdict}`);
  console.log(`File: ${rel(outFile)}`);
  if (summary.fail > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}
