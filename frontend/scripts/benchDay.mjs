// Hari-H eksperimen v2 (Tugas 9): satu perintah per fase. Seluruh output konsol juga ditulis ke
// benchmark-results/<runId>/day.log (tanpa kode warna). Jalankan dari Windows Terminal biasa (VS
// Code tertutup), dari root repo atau dari frontend:
//
//   npm run bench:day -- --phase pilot                        run baru: 1 sesi pilot per browser
//   npm run bench:day -- --phase measure --run-id <runId>     20 sesi ukur di run yang sama
//   … --dry                                                   uji alur dengan config mini (bukan data)
//
// pilot   : preflight → orkestrator --role pilot (ekspor design/, lalu sesi pilot) → validator sesi
//           pilot (validation-pilot.md) → ringkasan, perkiraan durasi fase measure, langkah berikutnya.
// measure : preflight → orkestrator --role measure (sesi lengkap dilewati, jadi perintah yang sama
//           melanjutkan run yang terputus) → runNative.mjs 10 invocation (dilewati bila native.json
//           sudah lengkap) → validator seluruh run → versi browser setiap sesi = versi di file
//           preflight pilot dan measure → zip benchmark-results/<runId>.zip.
// Preflight merah: berhenti sebelum sesi pertama. Measure menolak run yang sesi pilotnya belum
// lengkap, juga run yang validasi pilotnya gagal kecuali dengan --force. Tanpa --run-id, measure
// memakai run pilot terbaru dengan mode yang sama (dry atau bukan).
// --dry: config mini Tugas 8 (tests/experiment/bench.v2.mini.json) ditambah 1 sesi pilot per
//        browser (config turunan disimpan sebagai <run>/bench.dry.json), runId berawalan "dry-",
//        native 2 invocation dengan jeda 1 s. Hasilnya bukan data artikel.
// Exit code: 0 bila semua langkah lulus, 1 bila ada yang gagal, 130 bila dihentikan (Ctrl+C).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { buildSchedule, loadConfig, sessionComplete, stamp } from "../../tests/experiment/orchestrate.mjs";
import { MINI_CONFIG, REAL_CONFIG, versionNumber } from "./preflight.mjs";
import { validateRun } from "./validateRun.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, "..");
const REPO = resolve(FRONTEND, "..");
const ORCHESTRATOR = join(REPO, "tests/experiment/orchestrate.mjs");
const PREFLIGHT = join(here, "preflight.mjs");
const VALIDATOR = join(here, "validateRun.mjs");
const NATIVE = join(here, "runNative.mjs");
const DRY_NATIVE = { invocations: 2, pauseSec: 1 };
const REAL_NATIVE = { invocations: 10, pauseSec: 10 };

const rel = (p) => relative(REPO, p).split("\\").join("/");
const nowIso = () => new Date().toISOString();

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return "?";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}j${String(m).padStart(2, "0")}m` : `${m}m${String(s % 60).padStart(2, "0")}s`;
}

const ANSI = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (text) => String(text).replace(ANSI, "");

// --- Versi browser: preflight vs sesi ---

/**
 * Bandingkan versi browser setiap sesi dengan versi di file preflight.
 * preflights: [{ label, versions: { chrome: "155.0.8059.80", … } }]
 * sessions:   [{ id, browser, versions: ["Chrome/155.0.8059.80/@…", "155.0.8059.80", …] }]
 * Lulus bila semua preflight sepakat per browser dan setiap versi sesi sama dengan itu.
 */
export function compareBrowserVersions(preflights, sessions) {
  const table = {};
  const entry = (b) => (table[b] ??= { preflight: {}, sessions: {} });
  for (const p of preflights) for (const [b, v] of Object.entries(p.versions ?? {})) entry(b).preflight[p.label] = v;
  for (const s of sessions) {
    for (const v of s.versions) {
      const n = versionNumber(v) ?? String(v);
      const ids = (entry(s.browser).sessions[n] ??= []);
      if (!ids.includes(s.id)) ids.push(s.id);
    }
  }
  const problems = [];
  for (const [b, t] of Object.entries(table)) {
    const expected = [...new Set(Object.values(t.preflight).filter(Boolean))];
    if (expected.length === 0) problems.push(`${b}: tidak ada versi di file preflight`);
    if (expected.length > 1) problems.push(`${b}: versi berbeda antar preflight (${Object.entries(t.preflight).map(([l, v]) => `${l} ${v}`).join(", ")})`);
    for (const [v, ids] of Object.entries(t.sessions)) {
      if (!expected.includes(v)) problems.push(`${b} ${v} di ${ids.join(", ")} ≠ preflight ${expected.join("/") || "?"}`);
    }
  }
  return { passed: problems.length === 0, problems, table };
}

// --- Zip (deflate, nama UTF-8, tanpa zip64), lintas-OS tanpa dependensi ---

function listFiles(dir, prefix = "") {
  const out = [];
  for (const d of readdirSync(join(dir, prefix), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(dir, p));
    else if (d.isFile()) out.push(p);
  }
  return out;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Tulis zip berisi semua file di `dir` dengan nama `<root>/<path relatif>` (pemisah /). Ditulis ke
 * <zipPath>.tmp lalu di-rename. Mengembalikan { files, bytes, sha256 }.
 */
export function writeZip(dir, zipPath, root) {
  const tmp = `${zipPath}.tmp`;
  const fd = openSync(tmp, "w");
  const central = [];
  let offset = 0;
  const put = (buf) => {
    writeSync(fd, buf);
    offset += buf.length;
  };
  const files = listFiles(dir);
  try {
    for (const path of files) {
      const abs = join(dir, ...path.split("/"));
      const data = readFileSync(abs);
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      const method = deflated.length < data.length ? 8 : 0;
      const body = method === 8 ? deflated : data;
      const name = Buffer.from(`${root}/${path}`, "utf8");
      const { time, date } = dosDateTime(statSync(abs).mtime);
      const e = { name, method, time, date, crc: zlib.crc32(data), compSize: body.length, size: data.length, offset };
      if (offset + 30 + name.length + body.length > 0xffffffff) throw new Error("zip > 4 GB (zip64) tidak didukung");
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(20, 4); // versi 2.0
      h.writeUInt16LE(0x0800, 6); // nama UTF-8
      h.writeUInt16LE(method, 8);
      h.writeUInt16LE(time, 10);
      h.writeUInt16LE(date, 12);
      h.writeUInt32LE(e.crc, 14);
      h.writeUInt32LE(e.compSize, 18);
      h.writeUInt32LE(e.size, 22);
      h.writeUInt16LE(name.length, 26);
      h.writeUInt16LE(0, 28);
      put(h);
      put(name);
      put(body);
      central.push(e);
    }
    const cdOffset = offset;
    for (const e of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42); // extra, komentar, disk, atribut = 0
      put(h);
      put(e.name);
    }
    if (central.length > 0xffff) throw new Error("lebih dari 65535 file (zip64) tidak didukung");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdOffset, 12);
    end.writeUInt32LE(cdOffset, 16);
    put(end);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, zipPath);
  return { files: files.length, bytes: offset, sha256: createHash("sha256").update(readFileSync(zipPath)).digest("hex") };
}

// --- Run, sesi, dan day.json ---

const readJson = (p) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
};

/** Run pilot terbaru (day.json dengan langkah orkestrator pilot) dengan mode dry yang sama. */
export function latestPilotRun(resultsDir, dry) {
  if (!existsSync(resultsDir)) return null;
  let best = null;
  for (const d of readdirSync(resultsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const day = readJson(join(resultsDir, d.name, "day.json"));
    const pilot = day?.phases?.pilot;
    if (!pilot || Boolean(day.dry) !== dry || pilot.steps?.orchestrator === undefined) continue;
    if (!best || pilot.startedAt > best.at) best = { runId: d.name, at: pilot.startedAt };
  }
  return best?.runId ?? null;
}

/** Status sesi di jadwal (opsional per peran) dari session.json. */
function sessionStates(runDir, schedule, role = null) {
  return schedule
    .filter((s) => !role || s.role === role)
    .map((s) => {
      const rec = readJson(join(runDir, s.dir, "session.json"));
      return { ...s, record: rec, complete: sessionComplete(join(runDir, s.dir)) };
    });
}

function nativeComplete(runDir, invocations) {
  const m = readJson(join(runDir, "native", "native.json"));
  return Boolean(m?.finishedAt && m.settings?.invocations === invocations && m.invocations?.length === invocations) ? m : null;
}

// --- Main ---

function parseArgs(argv) {
  const a = { phase: null, runId: null, dry: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--phase") a.phase = argv[++i];
    else if (k === "--run-id") a.runId = argv[++i];
    else if (k === "--dry") a.dry = true;
    else if (k === "--force") a.force = true;
    else throw new Error(`Argumen tidak dikenal: ${k}`);
  }
  if (!["pilot", "measure"].includes(a.phase)) throw new Error("Pakai --phase pilot atau --phase measure (opsional --run-id <id>, --dry, --force).");
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRel = args.dry ? MINI_CONFIG : REAL_CONFIG;
  const results = resolve(REPO, loadConfig(resolve(REPO, baseRel)).outputDir);
  let runId = args.runId;
  if (!runId && args.phase === "measure") {
    runId = latestPilotRun(results, args.dry);
    if (!runId) throw new Error(`Tidak ada run pilot${args.dry ? " dry" : ""} di ${rel(results)}: jalankan --phase pilot dulu, atau beri --run-id.`);
  }
  runId ??= `${args.dry ? "dry-" : ""}${stamp()}`;
  const runDir = join(results, runId);
  if (args.phase === "measure" && !existsSync(join(runDir, "run.json"))) {
    throw new Error(`${rel(runDir)}/run.json tidak ada: jalankan --phase pilot dulu.`);
  }
  mkdirSync(runDir, { recursive: true });
  const day = readJson(join(runDir, "day.json")) ?? { runId, dry: args.dry, phases: {} };
  if (Boolean(day.dry) !== args.dry) throw new Error(`Run ${runId} ${day.dry ? "adalah run --dry" : "bukan run --dry"}; sesuaikan argumen --dry.`);

  // Config: bench.v2.json, atau (dry) config mini + 1 sesi pilot per browser yang disimpan di run
  let cfgPath = resolve(REPO, REAL_CONFIG);
  if (args.dry) {
    cfgPath = join(runDir, "bench.dry.json");
    if (!existsSync(cfgPath)) {
      const mini = JSON.parse(readFileSync(resolve(REPO, MINI_CONFIG), "utf8"));
      const derived = {
        ...mini,
        description: `${mini.description} Turunan benchDay.mjs --dry: 1 sesi pilot per browser.`,
        pilotSessions: Math.max(1, mini.pilotSessions),
      };
      writeFileSync(cfgPath, JSON.stringify(derived, null, 2) + "\n");
    }
  }
  const cfg = loadConfig(cfgPath);
  const schedule = buildSchedule(cfg);
  // Path relatif terhadap root repo: orkestrator dan preflight me-resolve --config dari root repo
  const cfgArg = rel(cfgPath);
  day.config = cfgArg;
  const saveDay = () => writeFileSync(join(runDir, "day.json"), JSON.stringify(day, null, 2) + "\n");

  // Log: konsol + day.log
  const logPath = join(runDir, "day.log");
  const write = (stream, text) => {
    stream.write(text);
    appendFileSync(logPath, stripAnsi(text));
  };
  const say = (msg = "") => write(process.stdout, `${msg}\n`);
  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
    say("\nCtrl+C: menunggu proses yang sedang berjalan berhenti…");
  });

  /** Jalankan skrip Node sebagai proses anak; stdout/stderr diteruskan ke konsol dan day.log. */
  const step = (title, script, scriptArgs, cwd, env = {}) =>
    new Promise((done) => {
      say(`\n━━ ${title} ━━  [${new Date().toTimeString().slice(0, 8)}]`);
      say(`$ node ${[rel(script), ...scriptArgs.map((a) => (a.startsWith(REPO) ? rel(a) : a))].join(" ")}`);
      const t0 = Date.now();
      const child = spawn(process.execPath, [script, ...scriptArgs], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d) => write(process.stdout, d));
      child.stderr.on("data", (d) => write(process.stderr, d));
      child.on("error", (err) => {
        say(`${title}: ${err.message}`);
        done({ exitCode: 1, durationMs: Date.now() - t0 });
      });
      child.on("close", (code, signal) => done({ exitCode: code ?? (signal ? 130 : 1), durationMs: Date.now() - t0 }));
    });

  // Catatan fase sebelumnya (mis. measure yang terputus lalu dilanjutkan) dipindah ke history
  if (day.phases[args.phase]) (day.history ??= []).push({ phase: args.phase, ...day.phases[args.phase] });
  const phase = { startedAt: nowIso(), finishedAt: null, steps: {} };
  day.phases[args.phase] = phase;
  saveDay();
  say(`\n${"═".repeat(78)}`);
  say(`bench:day --phase ${args.phase}${args.dry ? " --dry" : ""} · run ${runId} · ${new Date().toLocaleString("id-ID")}`);
  say(`config ${rel(cfgPath)} · output ${rel(runDir)}`);
  say("═".repeat(78));

  const finish = (code) => {
    phase.finishedAt = nowIso();
    phase.exitCode = code;
    saveDay();
    say(`\nLog lengkap: ${rel(logPath)}`);
    return code;
  };
  const stopIfInterrupted = () => (interrupted ? finish(130) : null);

  /** Preflight → salinan di run (preflight-<fase>.json); kembalikan exit code. */
  const preflight = async () => {
    const file = join(results, `preflight-${args.dry ? "dry-" : ""}${stamp()}.json`);
    phase.steps.preflight = await step("Preflight", PREFLIGHT, ["--config", cfgArg, "--out", file], FRONTEND, { FORCE_COLOR: "1" });
    if (existsSync(file)) copyFileSync(file, join(runDir, `preflight-${args.phase}.json`));
    phase.preflightFile = rel(file);
    saveDay();
    return phase.steps.preflight.exitCode;
  };
  const dryFlag = args.dry ? " --dry" : "";

  // ===== pilot =====
  const runPilot = async () => {
    if ((await preflight()) !== 0) {
      say("\nPreflight MERAH: berhenti sebelum sesi pertama. Perbaiki cek merah di atas, lalu jalankan perintah yang sama lagi.");
      return finish(1);
    }
    if (stopIfInterrupted() !== null) return 130;
    phase.steps.orchestrator = await step("Orkestrator: sesi pilot", ORCHESTRATOR, ["--config", cfgArg, "--run-id", runId, "--role", "pilot"], REPO);
    saveDay();
    if (stopIfInterrupted() !== null) return 130;
    phase.steps.validator = await step("Validator: sesi pilot", VALIDATOR, [runDir, "--role", "pilot"], FRONTEND);
    saveDay();
    if (stopIfInterrupted() !== null) return 130;

    const pilots = sessionStates(runDir, schedule, "pilot");
    const validation = readJson(join(runDir, "validation-pilot.json"));
    const passed = phase.steps.orchestrator.exitCode === 0 && validation?.passed === true;
    say(`\n${"═".repeat(78)}\nRingkasan fase pilot · run ${runId}\n${"═".repeat(78)}`);
    say(`Preflight : lulus (${rel(join(runDir, "preflight-pilot.json"))})`);
    for (const s of pilots) say(`Sesi      : ${s.id.padEnd(16)} ${s.record?.status ?? "tidak ada"} ${fmtDuration(s.record?.durationMs)}`);
    say(`Validator : ${validation ? (validation.passed ? "LULUS" : `${validation.violations.length} pelanggaran`) : "tidak ada hasil"} (${rel(join(runDir, "validation-pilot.md"))})`);

    // Perkiraan fase measure dari durasi sesi pilot per browser
    const perBrowser = cfg.browsers.map((b) => {
      const d = pilots.filter((s) => s.browser === b.name && s.record?.status === "done").map((s) => s.record.durationMs);
      return d.length ? d.reduce((x, y) => x + y, 0) / d.length : NaN;
    });
    const measureCount = cfg.sessions * cfg.browsers.length;
    const nativeMs = args.dry ? 15_000 : 3 * 60_000;
    const estimate = perBrowser.reduce((a, ms) => a + ms * cfg.sessions, 0) + measureCount * cfg.cooldownSec * 1000 + nativeMs;
    say(`Perkiraan : fase measure ${measureCount} sesi ≈ ${fmtDuration(estimate)} (termasuk cooldown ${cfg.cooldownSec} s dan native)`);
    say("\nLangkah berikutnya:");
    if (passed) {
      say(`  1. Baca ${rel(join(runDir, "validation-pilot.md"))}: median per sel, viewport, bagian Informasi.`);
      say(`  2. Jalankan fase ukur (jangan memakai komputer selama ±${fmtDuration(estimate)}):`);
      say(`       npm run bench:day -- --phase measure --run-id ${runId}${dryFlag}`);
      say("     Bila terputus, jalankan perintah yang sama lagi: sesi yang sudah lengkap dilewati.");
    } else {
      say(`  Pilot belum lulus; lihat ${rel(join(runDir, "validation-pilot.md"))} dan ${rel(logPath)}. Setelah penyebabnya diperbaiki:`);
      say(`  - ulangi satu sesi pilot: node tests/experiment/orchestrate.mjs --config ${cfgArg} --run-id ${runId} --only <pilot-chrome|pilot-firefox>`);
      say(`    lalu validasi ulang: npm run bench:day -- --phase pilot --run-id ${runId}${dryFlag} (sesi lengkap dilewati)`);
      say(`  - atau mulai run baru: npm run bench:day -- --phase pilot${dryFlag}`);
    }
    return finish(passed ? 0 : 1);
  };

  // ===== measure =====
  const runMeasure = async () => {
    const pilotStates = sessionStates(runDir, schedule, "pilot");
    const missingPilots = pilotStates.filter((s) => !s.complete).map((s) => s.id);
    if (missingPilots.length) {
      say(`\nSesi pilot belum lengkap (${missingPilots.join(", ")}): jalankan dulu npm run bench:day -- --phase pilot --run-id ${runId}${dryFlag}`);
      return finish(1);
    }
    const pilotValidation = validateRun(runDir, { role: "pilot" });
    if (pilotValidation.violations.length) {
      say(`\nValidasi pilot: ${pilotValidation.violations.length} pelanggaran (${rel(join(runDir, "validation-pilot.md"))}).`);
      if (!args.force) {
        say("Fase measure tidak dimulai. Perbaiki pilot, atau tambahkan --force untuk tetap lanjut.");
        return finish(1);
      }
      say("--force: tetap lanjut.");
    } else {
      say("\nValidasi pilot: LULUS");
    }
    const measureStates = sessionStates(runDir, schedule, "measure");
    const todo = measureStates.filter((s) => !s.complete).length;
    say(`Sesi ukur: ${measureStates.length - todo} lengkap, ${todo} akan dijalankan.`);

    if ((await preflight()) !== 0) {
      say("\nPreflight MERAH: berhenti sebelum sesi pertama. Perbaiki cek merah di atas, lalu jalankan perintah yang sama lagi.");
      return finish(1);
    }
    if (stopIfInterrupted() !== null) return 130;
    phase.steps.orchestrator = await step("Orkestrator: sesi ukur", ORCHESTRATOR, ["--config", cfgArg, "--run-id", runId, "--role", "measure"], REPO);
    saveDay();
    if (stopIfInterrupted() !== null) return 130;

    const nativeSettings = args.dry ? DRY_NATIVE : REAL_NATIVE;
    let native = nativeComplete(runDir, nativeSettings.invocations);
    if (native) {
      say(`\n━━ Native ━━\nnative/native.json sudah lengkap (${native.invocations.length} invocation, cek ${native.check?.passed ? "PASS" : "FAIL"}): dilewati.`);
      phase.steps.native = { exitCode: native.check?.passed ? 0 : 1, durationMs: 0, skipped: true };
    } else {
      const nativeArgs = [runDir, "--invocations", String(nativeSettings.invocations), "--pause-sec", String(nativeSettings.pauseSec)];
      phase.steps.native = await step(`Native: ${nativeSettings.invocations} invocation`, NATIVE, nativeArgs, FRONTEND);
      native = readJson(join(runDir, "native", "native.json"));
    }
    saveDay();
    if (stopIfInterrupted() !== null) return 130;

    phase.steps.validator = await step("Validator: seluruh run", VALIDATOR, [runDir], FRONTEND);
    saveDay();
    if (stopIfInterrupted() !== null) return 130;
    const validation = readJson(join(runDir, "validation.json"));

    // Versi browser: setiap sesi vs file preflight pilot dan measure
    say(`\n━━ Versi browser vs preflight ━━`);
    const preflights = ["pilot", "measure"]
      .map((p) => ({ label: `preflight-${p}`, json: readJson(join(runDir, `preflight-${p}.json`)) }))
      .filter((p) => p.json)
      .map((p) => ({ label: p.label, versions: p.json.browserVersions }));
    const sessions = sessionStates(runDir, schedule)
      .filter((s) => s.record)
      .map((s) => ({
        id: s.id,
        browser: s.browser,
        versions: [
          s.record.browserVersion,
          ...(s.record.batches ?? []).map((b) => (b.meta ? readJson(join(runDir, s.dir, b.meta))?.environment?.browserVersion : null)),
        ].filter(Boolean),
      }));
    const versions = compareBrowserVersions(preflights, sessions);
    for (const [b, t] of Object.entries(versions.table)) {
      say(`${b}: preflight ${Object.entries(t.preflight).map(([l, v]) => `${l.replace("preflight-", "")} ${v}`).join(", ")}; sesi ${Object.entries(t.sessions).map(([v, ids]) => `${v} (${ids.length} sesi)`).join(", ")}`);
    }
    say(versions.passed ? "Sama: LULUS" : `BERBEDA:\n${versions.problems.map((p) => `  - ${p}`).join("\n")}`);
    phase.versions = { passed: versions.passed, problems: versions.problems };
    saveDay();

    // Zip
    say(`\n━━ Zip ━━`);
    const zipPath = join(results, `${runId}.zip`);
    const zip = writeZip(runDir, zipPath, runId);
    phase.zip = { path: rel(zipPath), ...zip };
    say(`${rel(zipPath)}: ${zip.files} file, ${(zip.bytes / 1024 ** 2).toFixed(1)} MB, SHA-256 ${zip.sha256}`);
    saveDay();

    const measured = sessionStates(runDir, schedule, "measure");
    const done = measured.filter((s) => s.complete);
    const ok = {
      sessions: done.length === measured.length && phase.steps.orchestrator.exitCode === 0,
      native: native?.check?.passed === true,
      validator: validation?.passed === true,
      versions: versions.passed,
    };
    const passed = Object.values(ok).every(Boolean);
    say(`\n${"═".repeat(78)}\nRingkasan fase measure · run ${runId}\n${"═".repeat(78)}`);
    say(`Preflight     : lulus (${rel(join(runDir, "preflight-measure.json"))})`);
    say(`Sesi ukur     : ${done.length}/${measured.length} lengkap${ok.sessions ? "" : ` · bermasalah: ${measured.filter((s) => !s.complete).map((s) => s.id).join(", ")}`} (orkestrator ${fmtDuration(phase.steps.orchestrator.durationMs)})`);
    say(`Native        : ${native ? `${native.check?.passed ? "PASS" : "FAIL"} (${native.invocations?.length} invocation)` : "tidak ada hasil"}`);
    say(`Validator     : ${validation ? (validation.passed ? "LULUS" : `${validation.violations.length} pelanggaran`) : "tidak ada hasil"} (${rel(join(runDir, "validation.md"))})`);
    say(`Versi browser : ${versions.passed ? "sama dengan preflight" : "BERBEDA (lihat di atas)"}`);
    say(`Arsip         : ${rel(zipPath)} (SHA-256 ${zip.sha256.slice(0, 16)}…)`);
    say("\nLangkah berikutnya:");
    if (passed) {
      say(`  Salin ${rel(zipPath)} ke penyimpanan permanen dan catat SHA-256-nya; benchmark-results/ tidak di-commit.`);
    } else {
      say(`  Ada langkah yang gagal; lihat ${rel(join(runDir, "validation.md"))} dan ${rel(logPath)}.`);
      say(`  Ulangi sesi yang bermasalah: node tests/experiment/orchestrate.mjs --config ${cfgArg} --run-id ${runId} --only <sesi>`);
      say(`  lalu jalankan lagi: npm run bench:day -- --phase measure --run-id ${runId}${dryFlag} (sesi lengkap dan native dilewati).`);
    }
    return finish(passed ? 0 : 1);
  };

  try {
    return args.phase === "pilot" ? await runPilot() : await runMeasure();
  } catch (err) {
    say(`\nGAGAL: ${err?.stack ?? err}`);
    return finish(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    }
  );
}
