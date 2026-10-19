// Orkestrator sesi eksperimen v2 (Tugas 6): menjalankan sesi benchmark Binary Logistic
// (Experiment) di Chrome dan Firefox RILIS RESMI yang terpasang, lewat Puppeteer (WebDriver BiDi),
// selang-seling, satu browser baru dengan profil sementara yang bersih per sesi.
//
// Jalankan dari root repo setelah production build (`cd frontend && npm run build:experiment`):
//   node tests/experiment/orchestrate.mjs                               run baru (runId = waktu mulai)
//   node tests/experiment/orchestrate.mjs --run-id 20261019-090000      lanjutkan run: sesi lengkap dilewati
//   node tests/experiment/orchestrate.mjs --run-id <id> --only chrome-03   ulangi satu sesi
//   node tests/experiment/orchestrate.mjs --run-id <id> --role pilot   hanya sesi pilot (atau measure)
//   node tests/experiment/orchestrate.mjs --config tests/experiment/bench.v2.mini.json
//   node tests/experiment/orchestrate.mjs --plan                        tampilkan jadwal saja
// Hari-H memakai frontend/scripts/benchDay.mjs (preflight, --role pilot/measure, native, validator).
// Run yang dilanjutkan harus memakai config yang sama dengan run.json. Bila sesi terakhir run itu
// selesai kurang dari cooldownSec lalu, sesi pertama ditunda sampai cooldown terpenuhi.
//
// Konfigurasi: tests/experiment/bench.v2.json. Output: <outputDir>/<runId>/
//   run.json                         konfigurasi, jadwal, build, dataset, versi alat, ringkasan
//   design/N<N>.X.f64, .y.f64, .json design matrix workload core (baseline native, Tugas 7)
//   <browser>/<role>-<NN>/           CSV + meta.json tiap batch (dari window.__blExp) + session.json
//
// Aturan yang menjaga pengukuran:
// - Selama batch berjalan, orkestrator TIDAK berinteraksi dengan halaman: ia menunggu satu
//   evaluate `window.__blExp.waitForBatchOutputs(n)` yang selesai sendiri saat batch selesai
//   (tanpa polling rAF/MutationObserver di halaman).
// - Sebelum tiap batch, jendela browser dimaksimalkan dan dibawa ke foreground OS lewat user32
//   (mekanisme sama untuk kedua browser; tombol F24 tanpa efek membuka foreground lock Windows),
//   lalu page.bringToFront(). Status foreground OS di awal dan akhir batch dicatat di session.json.
//   Firefox di bawah otomasi BiDi selalu melaporkan document.hasFocus() = false walau jendelanya
//   foreground; validator memakai visibilityState/pageHidden dan status foreground OS.
// - Tidak ada emulasi viewport: DPR dan ukuran viewport mengikuti jendela yang dimaksimalkan
//   (dicatat di meta.environment). browsingContext.setViewport Firefox tidak andal di layar
//   berskala (perintahnya tidak pernah selesai), jadi tidak dipakai untuk kedua browser.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");
const FRONTEND = join(REPO, "frontend");
const require = createRequire(join(REPO, "package.json"));

// --- Urutan workload per sesi: salinan persis services/prng.ts (dicek test Jest) ---

export const WORKLOAD_ORDER_SALT = -2;

export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(seed, salt) {
  let h = (seed ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Sama dengan shuffledWorkloads di services/prng.ts. */
export function workloadOrder(workloads, orderSeed) {
  const base = [...new Set(workloads)].sort();
  return shuffleInPlace(base, mulberry32(deriveSeed(orderSeed, WORKLOAD_ORDER_SALT)));
}

// --- Konfigurasi dan jadwal ---

const REQUIRED = [
  "baseUrl", "datasetPath", "dependent", "covariates", "sizes", "warmup", "repetitions", "sampling",
  "sizeOrder", "lifecycle", "workloads", "browsers", "pilotSessions", "sessions", "cooldownSec", "orderSeedBase",
];

export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  const missing = REQUIRED.filter((k) => cfg[k] === undefined);
  if (missing.length) throw new Error(`Config ${path} is missing: ${missing.join(", ")}`);
  return {
    protocol: "webDriverBiDi",
    headless: false,
    dataSeed: 42,
    batchTimeoutMin: 45,
    window: { mode: "maximized" },
    foreground: true,
    outputDir: "benchmark-results",
    startServer: true,
    ...cfg,
  };
}

/**
 * Jadwal selang-seling: pilot-<browser> (atau pilot-<browser>-NN bila > 1 pilot) untuk tiap
 * browser, lalu <browser>-01 untuk tiap browser, <browser>-02, … index = posisi global (0-based),
 * orderSeed = orderSeedBase + index; urutan workload diacak dengan orderSeed itu.
 */
export function buildSchedule(cfg) {
  const out = [];
  const add = (browser, role, number) => {
    const index = out.length;
    const nn = String(number).padStart(2, "0");
    const id =
      role === "pilot" ? (cfg.pilotSessions > 1 ? `pilot-${browser.name}-${nn}` : `pilot-${browser.name}`) : `${browser.name}-${nn}`;
    const orderSeed = cfg.orderSeedBase + index;
    out.push({
      id,
      index,
      role,
      number,
      browser: browser.name,
      executablePath: browser.executablePath,
      orderSeed,
      workloads: workloadOrder(cfg.workloads, orderSeed),
      dir: `${browser.name}/${role}-${nn}`,
    });
  };
  for (let n = 1; n <= cfg.pilotSessions; n++) for (const b of cfg.browsers) add(b, "pilot", n);
  for (let n = 1; n <= cfg.sessions; n++) for (const b of cfg.browsers) add(b, "measure", n);
  return out;
}

/** Sesi lengkap: session.json berstatus done dan CSV + meta.json setiap workload ada. */
export function sessionComplete(sessionDir) {
  const p = join(sessionDir, "session.json");
  if (!existsSync(p)) return false;
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    return (
      s.status === "done" &&
      Array.isArray(s.batches) &&
      s.batches.length === (s.workloadOrder ?? []).length &&
      s.batches.every((b) => b.status === "done" && existsSync(join(sessionDir, b.csv)) && existsSync(join(sessionDir, b.meta)))
    );
  } catch {
    return false;
  }
}

/** Jumlah run satu batch (cocok dengan teks pratinjau dialog). */
export function runsPerBatch(cfg) {
  const cells = cfg.lifecycle === "interleaved" ? 6 : 4;
  return cfg.sizes.length * (cfg.warmup + cfg.repetitions) * cells;
}

/** JSON dengan kunci objek terurut, untuk membandingkan config tanpa bergantung urutan kunci. */
export function stableStringify(value) {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v
  );
}

/** Kunci config tingkat atas yang berbeda (description diabaikan). */
export function configDiff(a, b) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => k !== "description");
  return keys.filter((k) => stableStringify(a?.[k]) !== stableStringify(b?.[k])).sort();
}

/** Waktu (ms epoch) sesi terakhir run ini selesai, dari session.json setiap sesi jadwal; null bila belum ada. */
export function lastSessionFinishedAt(runDir, schedule) {
  let last = null;
  for (const s of schedule) {
    const p = join(runDir, s.dir, "session.json");
    if (!existsSync(p)) continue;
    try {
      const t = Date.parse(JSON.parse(readFileSync(p, "utf8")).finishedAt);
      if (Number.isFinite(t) && (last === null || t > last)) last = t;
    } catch {
      // session.json rusak: diabaikan
    }
  }
  return last;
}

// --- Alat bantu ---

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** runId bawaan: waktu mulai UTC, mis. 20261019-090000. */
export const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return "?";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s % 60).padStart(2, "0")}s`;
}

function log(msg) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);
}

function gitInfo() {
  const git = (...a) => {
    try {
      return execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  return { describe: git("describe", "--always", "--dirty", "--abbrev=8"), head: git("rev-parse", "HEAD") };
}

async function withTimeout(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${fmtDuration(ms)}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// --- Jendela tingkat OS (Windows): maksimalkan, foreground, status foreground ---

const PS_PRELUDE = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class BlExpWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
function Find-BrowserWindow([int]$root) {
  $ids = @($root) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$root" | ForEach-Object { $_.ProcessId })
  Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}`;

function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `${PS_PRELUDE}\n${script}`], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/**
 * Bawa jendela browser (proses `pid` atau anaknya, untuk Firefox) ke foreground OS dan
 * opsional maksimalkan. Mengembalikan { hwnd, foreground } atau null di luar Windows.
 */
export function osForeground(pid, { maximize = false } = {}) {
  if (process.platform !== "win32") return null;
  const out = powershell(`
$p = Find-BrowserWindow ${pid}
if (-not $p) { "hwnd=0 foreground=False"; exit }
$h = $p.MainWindowHandle
${maximize ? "[void][BlExpWin]::ShowWindow($h, 3)" : ""}
[BlExpWin]::keybd_event(0x87, 0, 0, [UIntPtr]::Zero)
[BlExpWin]::keybd_event(0x87, 0, 2, [UIntPtr]::Zero)
[void][BlExpWin]::SetForegroundWindow($h)
"hwnd=$h foreground=$([BlExpWin]::GetForegroundWindow() -eq $h)"`);
  return parseWindowState(out);
}

export function osIsForeground(pid) {
  if (process.platform !== "win32") return null;
  const out = powershell(`
$p = Find-BrowserWindow ${pid}
if (-not $p) { "hwnd=0 foreground=False"; exit }
"hwnd=$($p.MainWindowHandle) foreground=$([BlExpWin]::GetForegroundWindow() -eq $p.MainWindowHandle)"`);
  return parseWindowState(out);
}

function parseWindowState(out) {
  const m = /hwnd=(\d+) foreground=(True|False)/.exec(out);
  return m ? { hwnd: Number(m[1]), foreground: m[2] === "True", at: new Date().toISOString() } : { raw: out };
}

// --- Server aplikasi ---

async function httpOk(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

/** Ada proses yang menerima koneksi TCP di host:port baseUrl? */
export function portInUse(baseUrl, timeoutMs = 2000) {
  const u = new URL(baseUrl);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  return new Promise((done) => {
    const socket = net.connect({ host: u.hostname, port });
    const finish = (inUse) => {
      socket.destroy();
      done(inUse);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** `next start` production build di port baseUrl (dipakai orkestrator dan preflight). */
export async function startServer(cfg) {
  const port = new URL(cfg.baseUrl).port || "80";
  if (await httpOk(cfg.baseUrl)) {
    throw new Error(`${cfg.baseUrl} is already in use. Stop that server or set "startServer": false to reuse it.`);
  }
  const nextBin = require.resolve("next/dist/bin/next", { paths: [FRONTEND] });
  const child = spawn(process.execPath, [nextBin, "start", "-p", port], { cwd: FRONTEND, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    if (await httpOk(cfg.baseUrl)) return child;
    await sleep(1000);
  }
  child.kill();
  throw new Error(`next start did not answer on ${cfg.baseUrl} within 120 s`);
}

/** Matikan server dari startServer dan tunggu port kosong lagi; false bila port masih dipakai. */
export async function stopServer(child, cfg, timeoutMs = 15_000) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await Promise.race([exited, sleep(timeoutMs)]);
  }
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await sleep(250)) {
    if (!(await portInUse(cfg.baseUrl))) return true;
  }
  return false;
}

// --- Satu browser: buka aplikasi, impor dataset, pilih variabel ---

const tid = (id) => `[data-testid="${id}"]`;

async function openMenu(page, triggerId, ready) {
  for (let i = 0; i < 30; i++) {
    if (await ready()) return;
    await page.locator(tid(triggerId)).click();
    await sleep(500);
  }
  throw new Error(`Menu ${triggerId} did not open`);
}

async function launchBrowser(cfg, browserName, executablePath) {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    browser: browserName,
    executablePath,
    protocol: cfg.protocol,
    headless: cfg.headless,
    defaultViewport: null,
    // Satu evaluate menunggu seluruh batch (lihat waitForBatchOutputs)
    protocolTimeout: (cfg.batchTimeoutMin + 15) * 60_000,
    // Tanpa argumen jendela: dengan --window-position, MainWindowHandle Chrome bernilai 0 sehingga
    // jendela tidak bisa dimaksimalkan/dibawa ke foreground; posisi diatur lewat maksimalisasi OS.
    args: [],
  });
  const spawnargs = browser.process()?.spawnargs ?? [];
  // Profil sementara yang dibuat Puppeteer: Chrome --user-data-dir=..., Firefox --profile <dir>
  const udd = spawnargs.find((a) => a.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  const profIdx = spawnargs.findIndex((a) => a === "--profile" || a === "-profile");
  const profileDir = udd ?? (profIdx >= 0 ? spawnargs[profIdx + 1] : null);
  let firefoxUserJs = null;
  if (browserName === "firefox" && profileDir && existsSync(join(profileDir, "user.js"))) {
    firefoxUserJs = readFileSync(join(profileDir, "user.js"), "utf8");
  }
  return { browser, spawnargs, profileDir, firefoxUserJs, pid: browser.process()?.pid ?? null };
}

async function prepareApp(cfg, page, query, record) {
  await page.goto(`${cfg.baseUrl}/dashboard/data?${new URLSearchParams(query)}`, { waitUntil: "networkidle0" });
  record.windowAtStart = cfg.foreground ? osForeground(record.pid, { maximize: cfg.window?.mode === "maximized" }) : null;
  await page.bringToFront();

  // Impor CSV lewat File > Import > CSV (input file). Firefox (BiDi input.setFiles) di Windows
  // butuh path native, jadi path di-resolve ke bentuk OS.
  await openMenu(page, "file-menu-trigger", async () => (await page.$(tid("file-menu-import-trigger"))) !== null);
  await page.locator(tid("file-menu-import-trigger")).click();
  await page.locator(tid("file-menu-import-csv")).click();
  const input = await page.waitForSelector(tid("dropzone-input"));
  await input.uploadFile(resolve(REPO, cfg.datasetPath));
  await page.locator("button ::-p-text(Continue)").click();
  const tImport = Date.now();
  await page.locator("button ::-p-text(Import)").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="modal-title"]'), { timeout: 10 * 60_000, polling: 1000 });
  record.importMs = Date.now() - tImport;

  // Analyze > Regression > Binary Logistic (Experiment)...
  await openMenu(page, "analyze-menu-trigger", async () =>
    (await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent?.trim()))).includes("Regression")
  );
  await page.locator('[role="menuitem"] ::-p-text(Regression)').click();
  await page.locator('[role="menuitem"] ::-p-text(Binary Logistic (Experiment)...)').click();
  await page.waitForSelector(tid("bl-exp-dialog"));
  await page.locator(tid(`bl-exp-variable-item-${cfg.dependent}`)).click();
  await page.locator(tid("bl-exp-move-to-dependent")).click();
  for (const v of cfg.covariates) {
    await page.locator(tid(`bl-exp-variable-item-${v}`)).click();
    await page.locator(tid("bl-exp-move-to-covariates")).click();
  }
  await page.locator(tid("bl-exp-tab-experiment")).click();
  record.datasetInfo = await page.$eval(tid("bl-exp-dataset-info"), (e) => e.textContent?.replace(/\s+/g, " ").trim());
}

// --- Pengaturan batch di dialog ---

async function setChecked(page, id, want) {
  const checked = await page.$eval(tid(id), (e) => e.getAttribute("data-state") === "checked");
  if (checked !== want) await page.locator(tid(id)).click();
}

async function applySettings(cfg, page, orderSeed) {
  // Semua ukuran lewat kolom Custom, supaya tepat sama dengan konfigurasi
  await setChecked(page, "bl-exp-size-original", false);
  for (const n of [10000, 50000, 100000]) await setChecked(page, `bl-exp-size-${n}`, false);
  await page.locator("#bl-exp-custom-sizes").fill(cfg.sizes.join(", "));
  await page.locator(tid(`bl-exp-sampling-${cfg.sampling}`)).click();
  await page.locator(tid(`bl-exp-size-order-${cfg.sizeOrder}`)).click();
  await page.locator(tid(`bl-exp-lifecycle-${cfg.lifecycle}`)).click();
  await page.locator(tid("bl-exp-warmup")).fill(String(cfg.warmup));
  await page.locator(tid("bl-exp-repetitions")).fill(String(cfg.repetitions));
  await page.locator(tid("bl-exp-data-seed")).fill(String(cfg.dataSeed));
  await page.locator(tid("bl-exp-order-seed")).fill(String(orderSeed));
  // Cek silang dengan pratinjau dialog: "… = 840 runs"
  const expected = runsPerBatch(cfg).toLocaleString("en-US");
  const preview = await page.evaluate(() => document.body.innerText.match(/= ([\d,]+) runs/)?.[1] ?? null);
  if (preview !== expected) throw new Error(`Batch preview shows ${preview} runs, expected ${expected}`);
}

// --- Sesi ---

async function runSession(cfg, s, runDir, sessionDir, info) {
  mkdirSync(sessionDir, { recursive: true });
  const record = {
    sessionId: s.id,
    sessionIndex: s.index,
    role: s.role,
    browser: s.browser,
    orderSeed: s.orderSeed,
    workloadOrder: s.workloads,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    error: null,
    host: info.host,
    tools: info.tools,
    git: info.git,
    buildId: info.buildId,
    build: info.build,
    baseUrl: cfg.baseUrl,
    batches: [],
    consoleErrors: [],
  };
  const save = () => writeFileSync(join(sessionDir, "session.json"), JSON.stringify(record, null, 2) + "\n");
  save();
  const t0 = Date.now();
  let launched = null;
  let page = null;
  try {
    launched = await launchBrowser(cfg, s.browser, s.executablePath);
    const { browser } = launched;
    record.pid = launched.pid;
    record.browserVersion = await browser.version();
    record.spawnargs = launched.spawnargs;
    record.profileDir = launched.profileDir;
    record.firefoxUserJs = launched.firefoxUserJs;
    save();
    page = (await browser.pages())[0] ?? (await browser.newPage());
    page.on("console", (m) => {
      if (m.type() === "error") record.consoleErrors.push(m.text().slice(0, 500));
    });
    page.on("pageerror", (e) => record.consoleErrors.push(`[pageerror] ${String(e.message).slice(0, 500)}`));
    page.setDefaultTimeout(120_000);

    const query = {
      expAutomation: "1",
      expSession: s.id,
      expSessionIndex: String(s.index),
      expRole: s.role,
      expBrowser: s.browser,
    };
    await prepareApp(cfg, page, query, record);
    await applySettings(cfg, page, s.orderSeed);
    save();

    for (const [k, workload] of s.workloads.entries()) {
      const label = `${s.id} · ${workload} (${k + 1}/${s.workloads.length})`;
      const before = await page.evaluate(() => window.__blExp.getBatchOutputs().length);
      await page.locator(tid(`bl-exp-workload-${workload}`)).click();
      const batch = { workload, status: "running", startedAt: null, durationMs: null, csv: null, meta: null };
      record.batches.push(batch);
      // Foreground OS + fokus dokumen sebelum batch; tidak ada interaksi selama batch
      batch.windowBefore = cfg.foreground ? osForeground(launched.pid) : null;
      await page.bringToFront();
      batch.startedAt = new Date().toISOString();
      save();
      log(`${label}: started (${runsPerBatch(cfg)} runs)`);
      const tb = Date.now();
      await page.locator(tid("bl-exp-run-batch")).click();
      await withTimeout(
        page.evaluate((n) => window.__blExp.waitForBatchOutputs(n), before + 1),
        cfg.batchTimeoutMin * 60_000,
        `Batch ${label}`
      );
      batch.durationMs = Date.now() - tb;
      batch.windowAfter = cfg.foreground ? osIsForeground(launched.pid) : null;
      const out = (await page.evaluate(() => window.__blExp.getBatchOutputs())).at(-1);
      batch.batchId = out.batchId;
      batch.status = out.status;
      batch.csv = `${out.batchId}.csv`;
      batch.meta = `${out.batchId}-meta.json`;
      writeFileSync(join(sessionDir, batch.csv), out.csv);
      writeFileSync(join(sessionDir, batch.meta), out.metaJson);
      save();
      log(`${label}: ${out.status} in ${fmtDuration(batch.durationMs)}`);
      if (out.status !== "done") throw new Error(`Batch ${out.batchId} ended with status ${out.status}`);
    }
    record.status = "done";
  } catch (err) {
    record.status = "error";
    record.error = String(err?.stack ?? err);
    if (page) {
      try {
        await page.screenshot({ path: join(sessionDir, "error.png") });
      } catch {
        // screenshot opsional
      }
    }
  } finally {
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.now() - t0;
    save();
    try {
      await launched?.browser.close();
    } catch {
      // browser mungkin sudah mati
    }
  }
  return record;
}

/** Design matrix workload core per N (prefix yang sama dengan batch) untuk baseline native. */
async function exportDesigns(cfg, runDir, info) {
  const dir = join(runDir, "design");
  const done = cfg.sizes.every((N) => ["X.f64", "y.f64", "json"].every((ext) => existsSync(join(dir, `N${N}.${ext}`))));
  if (done) {
    log("design: already exported, skipped");
    return;
  }
  mkdirSync(dir, { recursive: true });
  const b = cfg.browsers[0];
  log(`design: exporting X/y for N = ${cfg.sizes.join(", ")} with ${b.name}`);
  const launched = await launchBrowser(cfg, b.name, b.executablePath);
  try {
    const page = (await launched.browser.pages())[0] ?? (await launched.browser.newPage());
    page.setDefaultTimeout(120_000);
    const record = { pid: launched.pid };
    await prepareApp(cfg, page, { expAutomation: "1", expSession: "design", expBrowser: b.name }, record);
    for (const N of cfg.sizes) {
      const d = await page.evaluate((n) => window.__blExp.exportDesign(n), N);
      const X = Buffer.from(d.X_b64, "base64");
      const y = Buffer.from(d.y_b64, "base64");
      if (sha256(X) !== d.sha256.X || sha256(y) !== d.sha256.y || X.length !== d.n * d.p * 8 || y.length !== d.n * 8) {
        throw new Error(`Design N = ${N}: byte length or SHA-256 mismatch`);
      }
      writeFileSync(join(dir, `N${N}.X.f64`), X);
      writeFileSync(join(dir, `N${N}.y.f64`), y);
      writeFileSync(
        join(dir, `N${N}.json`),
        JSON.stringify(
          {
            N,
            n: d.n,
            p: d.p,
            featureNames: d.featureNames,
            sha256: d.sha256,
            layout: "Float64 little-endian; X row-major n × p (column 0 = intercept), y 0/1",
            sampling: "first N rows of the prepared dataset (same as batch sampling \"prefix\")",
            dataset: cfg.datasetPath,
            exportedWith: { browser: b.name, version: await launched.browser.version(), buildId: info.buildId, git: info.git },
          },
          null,
          2
        ) + "\n"
      );
      log(`design: N = ${N} (n = ${d.n}, p = ${d.p})`);
    }
  } finally {
    await launched.browser.close();
  }
}

// --- Main ---

function parseArgs(argv) {
  const args = { config: "tests/experiment/bench.v2.json", runId: null, only: null, role: null, plan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i];
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--role") args.role = argv[++i];
    else if (a === "--plan") args.plan = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (args.role !== null && !["pilot", "measure"].includes(args.role)) throw new Error(`--role must be pilot or measure, got ${args.role}`);
  return args;
}

/** .next/EXPERIMENT_BUILD.json dari `npm run build:experiment` (null untuk build lama). */
function buildInfo() {
  const p = join(FRONTEND, ".next", "EXPERIMENT_BUILD.json");
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(resolve(REPO, args.config));
  const schedule = buildSchedule(cfg);
  if (args.plan) {
    for (const s of schedule) console.log(`${String(s.index).padStart(2)} ${s.id.padEnd(16)} orderSeed ${s.orderSeed} ${s.workloads.join(" → ").padEnd(13)} ${s.dir}`);
    return;
  }
  if (args.only && !schedule.some((s) => s.id === args.only)) throw new Error(`--only ${args.only}: no such session in the schedule`);

  const runId = args.runId ?? stamp();
  const runDir = resolve(REPO, cfg.outputDir, runId);
  const runJsonPath = join(runDir, "run.json");
  const previous = existsSync(runJsonPath) ? JSON.parse(readFileSync(runJsonPath, "utf8")) : null;
  if (previous?.config) {
    const diff = configDiff(previous.config, cfg);
    if (diff.length) throw new Error(`${args.config} differs from ${runJsonPath} in: ${diff.join(", ")}. Resume a run with the config it started with.`);
  }
  mkdirSync(runDir, { recursive: true });

  // Pemeriksaan awal: browser, dataset (SHA-256 vs manifest), build
  for (const b of cfg.browsers) if (!existsSync(b.executablePath)) throw new Error(`Browser not found: ${b.executablePath}`);
  const datasetPath = resolve(REPO, cfg.datasetPath);
  const datasetSha = sha256(readFileSync(datasetPath));
  const manifestPath = datasetPath.replace(/\.csv$/, ".manifest.json");
  const manifestSha = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).output?.sha256 : null;
  if (manifestSha && manifestSha !== datasetSha) throw new Error(`Dataset SHA-256 ${datasetSha} differs from its manifest (${manifestSha})`);
  const buildIdPath = join(FRONTEND, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) throw new Error("No production build: run `npm run build:experiment` in frontend first.");
  const info = {
    host: {
      platform: process.platform,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model ?? null,
      logicalCpus: os.cpus().length,
      totalMemGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    },
    tools: { node: process.version, puppeteer: require("puppeteer-core/package.json").version },
    git: gitInfo(),
    buildId: readFileSync(buildIdPath, "utf8").trim(),
    build: buildInfo(),
  };
  if (info.git.describe?.endsWith("-dirty")) log("WARNING: the working tree is dirty; the build may not match HEAD.");
  if (info.build && info.build.gitHead !== info.git.head) log(`WARNING: the build is from ${info.build.gitCommit}, HEAD is ${info.git.describe}.`);

  const runJson = previous ?? { runId, invocations: [] };
  runJson.config = cfg;
  runJson.schedule = schedule;
  runJson.dataset = { path: cfg.datasetPath, sha256: datasetSha, manifestSha256: manifestSha };
  runJson.invocations.push({ startedAt: new Date().toISOString(), args, ...info });
  writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2) + "\n");

  let server = null;
  const killServer = () => {
    if (server && !server.killed) server.kill();
  };
  process.on("SIGINT", () => {
    killServer();
    process.exit(130);
  });
  try {
    if (cfg.startServer) {
      log(`server: next start on ${cfg.baseUrl} (build ${info.buildId}, ${info.build?.gitCommit ?? `HEAD ${info.git.describe}`})`);
      server = await startServer(cfg);
    }
    await exportDesigns(cfg, runDir, info);

    const todo = schedule.filter((s) => (args.only ? s.id === args.only : true) && (args.role ? s.role === args.role : true));
    const results = [];
    const durations = [];
    // Cooldown juga berlaku terhadap sesi terakhir invocation sebelumnya (fase pilot → measure, resume)
    const lastFinished = lastSessionFinishedAt(runDir, schedule);
    let first = true;
    for (const [i, s] of todo.entries()) {
      const sessionDir = join(runDir, s.dir);
      if (args.only && existsSync(sessionDir)) {
        renameSync(sessionDir, `${sessionDir}.replaced-${stamp()}`);
      } else if (!args.only && sessionComplete(sessionDir)) {
        log(`[${i + 1}/${todo.length}] ${s.id}: complete, skipped`);
        results.push({ id: s.id, status: "skipped (complete)", durationMs: null });
        continue;
      } else if (existsSync(sessionDir)) {
        renameSync(sessionDir, `${sessionDir}.incomplete-${stamp()}`);
      }
      if (first && lastFinished !== null) {
        const waitMs = cfg.cooldownSec * 1000 - (Date.now() - lastFinished);
        if (waitMs > 0) {
          log(`cooldown ${Math.ceil(waitMs / 1000)} s (the previous session of this run finished ${Math.round((Date.now() - lastFinished) / 1000)} s ago)`);
          await sleep(waitMs);
        }
      }
      first = false;
      log(`[${i + 1}/${todo.length}] ${s.id}: ${s.browser}, ${s.role}, orderSeed ${s.orderSeed}, workloads ${s.workloads.join(" → ")}`);
      const rec = await runSession(cfg, s, runDir, sessionDir, info);
      durations.push(rec.durationMs);
      results.push({ id: s.id, status: rec.status, durationMs: rec.durationMs, error: rec.error?.split("\n")[0] ?? null });
      const left = todo.length - i - 1;
      const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
      log(
        `[${i + 1}/${todo.length}] ${s.id}: ${rec.status} in ${fmtDuration(rec.durationMs)}` +
          (rec.status !== "done" ? ` — ${rec.error?.split("\n")[0]}` : "") +
          (left > 0 ? ` · ~${fmtDuration(left * (mean + cfg.cooldownSec * 1000))} left (${left} session(s))` : "")
      );
      if (left > 0 && cfg.cooldownSec > 0) {
        log(`cooldown ${cfg.cooldownSec} s`);
        await sleep(cfg.cooldownSec * 1000);
      }
    }

    console.log("\nSummary");
    for (const r of results) console.log(`  ${r.id.padEnd(16)} ${String(r.status).padEnd(20)} ${r.durationMs ? fmtDuration(r.durationMs) : ""} ${r.error ?? ""}`);
    runJson.invocations.at(-1).finishedAt = new Date().toISOString();
    runJson.invocations.at(-1).results = results;
    writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2) + "\n");
    console.log(`\nOutput: ${runDir}`);
    if (results.some((r) => r.status === "error")) process.exitCode = 1;
  } finally {
    killServer();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}
