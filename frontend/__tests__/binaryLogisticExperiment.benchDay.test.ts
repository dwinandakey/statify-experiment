/**
 * Hari-H v2 (Tugas 9): fungsi murni scripts/preflight.mjs (status baterai, mode daya, updater,
 * proses pengganggu, git status, build, artefak, server, disk) dan scripts/benchDay.mjs (versi
 * browser vs preflight, zip, run pilot terbaru, kode warna di day.log), plus --role di
 * validateRun.mjs. Skrip berupa ES module, jadi dijalankan di proses Node terpisah.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const scripts = path.join(__dirname, "../scripts");

function withModule<T>(file: string, body: string): T {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(path.join(scripts, file)).href)});\n${body}`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module"], { input: code, encoding: "utf8" })) as T;
}
const preflight = <T>(expr: string) => withModule<T>("preflight.mjs", `console.log(JSON.stringify(${expr}));`);
const benchDay = <T>(expr: string) => withModule<T>("benchDay.mjs", `console.log(JSON.stringify(${expr}));`);
type Result = { status: "ok" | "warn" | "fail"; detail: string };
const MEASURED = "3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d";

test("daya: BatteryStatus AC/mengisi hijau, discharging merah, tidak pasti kuning, tanpa baterai hijau", () => {
  const r = preflight<Result[]>(`[
    m.evaluateBattery([{ BatteryStatus: 2, EstimatedChargeRemaining: 100 }]),
    m.evaluateBattery([{ BatteryStatus: 6, EstimatedChargeRemaining: 80 }]),
    m.evaluateBattery([{ BatteryStatus: 1, EstimatedChargeRemaining: 90 }]),
    m.evaluateBattery([{ BatteryStatus: 11 }]),
    m.evaluateBattery([]),
    m.evaluateBattery([{ BatteryStatus: 2 }, { BatteryStatus: 4 }]),
  ]`);
  expect(r.map((x) => x.status)).toEqual(["ok", "ok", "fail", "warn", "ok", "fail"]);
  expect(r[0].detail).toBe("tercolok charger: BatteryStatus 2 (AC, 100%)");
  expect(r[2].detail).toMatch(/^TIDAK tercolok charger/);
});

test("mode daya: skema dicetak; overlay Best performance hijau, selain itu kuning", () => {
  const scheme = "Power Scheme GUID: 14731dd7-985b-4181-9d4a-cfd3413c0d3d  (Acer)";
  const r = preflight<Result[]>(`[
    m.evaluatePowerMode(${JSON.stringify(scheme)}, "ded574b5-45a0-4f42-8737-46345c09c238"),
    m.evaluatePowerMode(${JSON.stringify(scheme)}, null),
    m.evaluatePowerMode("GUID Skema Daya: 381b4222-f694-41f0-9685-ff5bb260df2e  (Seimbang)", "961cc777-2547-4f9d-8174-7d86181b8a7a"),
  ]`);
  expect(r.map((x) => x.status)).toEqual(["ok", "warn", "warn"]);
  expect(r[0].detail).toBe('skema "Acer" (14731dd7-985b-4181-9d4a-cfd3413c0d3d); mode daya (AC): Best performance');
  expect(r[1].detail).toContain("Balanced (protokol: Best performance)");
  expect(r[2].detail).toContain('skema "Seimbang"');
});

test("updater: service Running/Automatic dan task Ready kuning; Manual/Disabled hijau", () => {
  const r = preflight<Result[]>(`[
    m.evaluateUpdaters([{ Name: "GoogleUpdaterService157.0.8089.0", Status: "Stopped", StartType: "Automatic" }], [], { isAdmin: true }),
    m.evaluateUpdaters([], [{ TaskPath: "\\\\Mozilla\\\\", TaskName: "Firefox Background Update X", State: "Ready" }], { isAdmin: true }),
    m.evaluateUpdaters([{ Name: "gupdate", Status: "Stopped", StartType: "Manual" }], [{ TaskPath: "\\\\", TaskName: "GoogleUpdaterTaskSystem", State: "Disabled" }], { isAdmin: true }),
    m.evaluateUpdaters([], [], { isAdmin: false }),
  ]`);
  expect(r.map((x) => x.status)).toEqual(["warn", "warn", "ok", "ok"]);
  expect(r[0].detail).toContain("service GoogleUpdaterService157.0.8089.0 (Stopped, Automatic)");
  expect(r[1].detail).toContain("task \\Mozilla\\Firefox Background Update X (Ready)");
  expect(r[3].detail).toContain("Tanpa hak admin");
});

test("proses pengganggu: nama Windows (.exe opsional) dan Linux dihitung per aplikasi", () => {
  const r = preflight<Result[]>(`[
    m.evaluateProcesses(["Code", "Code", "OneDrive", "ms-teams", "Discord.exe", "msedge", "explorer", "node"]),
    m.evaluateProcesses(["systemd", "firefox-bin", "code"]),
    m.evaluateProcesses(["explorer", "node", "powershell"]),
  ]`);
  expect(r[0]).toEqual({
    status: "warn",
    detail:
      "berjalan: VS Code (2 proses), OneDrive (1 proses), Microsoft Teams (1 proses), Discord (1 proses), Microsoft Edge (1 proses). Tutup sebelum sesi; orkestrator meluncurkan browser sendiri.",
  });
  expect(r[1].detail).toMatch(/^berjalan: VS Code \(1 proses\), Firefox \(1 proses\)/);
  expect(r[2].status).toBe("ok");
});

test("git status: file terlacak berubah merah (petunjuk next-env.d.ts), untracked kuning, bersih hijau", () => {
  const r = preflight<Result[]>(`[
    m.evaluateGitStatus(" M frontend/next-env.d.ts\\n?? notes.txt\\n"),
    m.evaluateGitStatus("?? notes.txt\\n"),
    m.evaluateGitStatus(""),
  ]`);
  expect(r.map((x) => x.status)).toEqual(["fail", "warn", "ok"]);
  expect(r[0].detail).toContain("git restore frontend/next-env.d.ts");
  expect(r[1].detail).toBe("bersih, tetapi ada file untracked: notes.txt");
});

test("build: harus ada, cocok dengan BUILD_ID, tidak -dirty, dan = HEAD", () => {
  const info = { gitCommit: "experiment-v1.0.0-12-gabcdef12", gitHead: "abc", nextBuildId: "B1", builtAt: "2026-10-19T00:00:00Z" };
  const cases = [
    { buildId: null, info: null, head: "abc", describe: "x" },
    { buildId: "B1", info: null, head: "abc", describe: "x" },
    { buildId: "B2", info, head: "abc", describe: "x" },
    { buildId: "B1", info: { ...info, gitCommit: `${info.gitCommit}-dirty` }, head: "abc", describe: "x" },
    { buildId: "B1", info, head: "def", describe: "experiment-v1.0.0-13-gdef00000" },
    { buildId: "B1", info, head: "abc", describe: "experiment-v1.0.0-12-gabcdef12" },
  ];
  const r = preflight<Result[]>(`${JSON.stringify(cases)}.map((c) => m.evaluateBuild(c))`);
  expect(r.map((x) => x.status)).toEqual(["fail", "fail", "fail", "fail", "fail", "ok"]);
  expect(r[4].detail).toBe("build dari experiment-v1.0.0-12-gabcdef12, HEAD sekarang experiment-v1.0.0-13-gdef00000; jalankan `npm run build:experiment`");
  expect(r[5].detail).toMatch(/^experiment-v1\.0\.0-12-gabcdef12 = HEAD/);
});

test("artefak dan server: hash .wasm harus biner yang diukur; COOP/COEP wajib", () => {
  const r = preflight<Result[]>(`[
    m.evaluateArtifacts({ checkStatus: 0, checkOutput: "", wasmSha256: ${JSON.stringify(MEASURED)} }),
    m.evaluateArtifacts({ checkStatus: 1, checkOutput: "a\\nARTIFACT_HASHES.json is missing or outdated", wasmSha256: ${JSON.stringify(MEASURED)} }),
    m.evaluateArtifacts({ checkStatus: 0, checkOutput: "", wasmSha256: "00" }),
    m.evaluateServer({ pageStatus: 200, coop: "same-origin", coep: "require-corp", wasmStatus: 200, wasmSha256: ${JSON.stringify(MEASURED)} }),
    m.evaluateServer({ pageStatus: 200, coop: null, coep: "require-corp", wasmStatus: 200, wasmSha256: "00" }),
    m.evaluateServer({ pageStatus: 500, coop: "same-origin", coep: null, wasmStatus: 404, wasmSha256: null }),
  ]`);
  expect(r.map((x) => x.status)).toEqual(["ok", "fail", "fail", "ok", "fail", "fail"]);
  expect(r[1].detail).toBe("ARTIFACT_HASHES.json tidak cocok dengan file: ARTIFACT_HASHES.json is missing or outdated");
  expect(r[4].detail).toBe("COOP tidak ada (harus same-origin); .wasm yang dilayani (00…) bukan biner yang diukur");
  expect(r[5].detail).toBe("/dashboard/data → HTTP 500; COEP tidak ada (harus require-corp); .wasm → HTTP 404");
});

test("disk ≥ 5 GB dan nomor versi dari teks versi browser", () => {
  const r = preflight<{ disk: Result[]; versions: (string | null)[] }>(`{
    disk: [m.evaluateDisk(6 * 1024 ** 3, "benchmark-results"), m.evaluateDisk(4.9 * 1024 ** 3, "benchmark-results")],
    versions: ["Chrome/155.0.8059.80/@43a195105613ac83c21d3f14de279f4a045c7da0", "firefox/158.0", "Mozilla Firefox 158.0.1", "Google Chrome 155.0.8059.80 ", null].map(m.versionNumber),
  }`);
  expect(r.disk.map((x) => x.status)).toEqual(["ok", "fail"]);
  expect(r.disk[0].detail).toBe("6.0 GB kosong di benchmark-results (minimum 5 GB)");
  expect(r.versions).toEqual(["155.0.8059.80", "158.0", "158.0.1", "155.0.8059.80", null]);
});

test("versi browser setiap sesi dibandingkan dengan semua file preflight", () => {
  const preflights = [
    { label: "preflight-pilot", versions: { chrome: "155.0.8059.80", firefox: "158.0" } },
    { label: "preflight-measure", versions: { chrome: "155.0.8059.80", firefox: "158.0" } },
  ];
  const sessions = [
    { id: "pilot-chrome", browser: "chrome", versions: ["Chrome/155.0.8059.80/@43a1", "155.0.8059.80", "155.0.8059.80"] },
    { id: "firefox-01", browser: "firefox", versions: ["firefox/158.0", "158.0"] },
  ];
  type Cmp = { passed: boolean; problems: string[]; table: Record<string, { sessions: Record<string, string[]> }> };
  const same = benchDay<Cmp>(`m.compareBrowserVersions(${JSON.stringify(preflights)}, ${JSON.stringify(sessions)})`);
  expect(same.passed).toBe(true);
  expect(same.table.chrome.sessions).toEqual({ "155.0.8059.80": ["pilot-chrome"] });
  // Firefox diperbarui antara fase pilot dan measure: kedua preflight tidak sepakat
  const firefox02 = { id: "firefox-02", browser: "firefox", versions: ["firefox/158.0.1"] };
  const betweenPhases = benchDay<Cmp>(
    `m.compareBrowserVersions(${JSON.stringify([preflights[0], { ...preflights[1], versions: { chrome: "155.0.8059.80", firefox: "158.0.1" } }])}, ${JSON.stringify([
      ...sessions,
      firefox02,
    ])})`
  );
  expect(betweenPhases.passed).toBe(false);
  expect(betweenPhases.problems).toEqual(["firefox: versi berbeda antar preflight (preflight-pilot 158.0, preflight-measure 158.0.1)"]);
  expect(betweenPhases.table.firefox.sessions).toEqual({ "158.0": ["firefox-01"], "158.0.1": ["firefox-02"] });
  // Diperbarui di tengah fase measure: preflight sepakat, satu sesi berbeda
  const midRun = benchDay<Cmp>(`m.compareBrowserVersions(${JSON.stringify(preflights)}, ${JSON.stringify([...sessions, firefox02])})`);
  expect(midRun.passed).toBe(false);
  expect(midRun.problems).toEqual(["firefox 158.0.1 di firefox-02 ≠ preflight 158.0"]);
});

/** Pembaca zip minimal (EOCD → central directory → local header) untuk memeriksa writeZip. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt16LE(p + 8) & 0x0800).toBe(0x0800);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    expect(zlib.crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

test("zip: semua file (subfolder, biner, nama UTF-8) di bawah <runId>/, pemisah /, isi utuh", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "benchday-"));
  try {
    const run = path.join(dir, "dry-20261019-000000");
    fs.mkdirSync(path.join(run, "chrome", "pilot-01"), { recursive: true });
    fs.mkdirSync(path.join(run, "design"));
    const files: Record<string, Buffer> = {
      "run.json": Buffer.from(JSON.stringify({ runId: "x", note: "μ × → ✓" })),
      "chrome/pilot-01/batch.csv": Buffer.from("N,cell\n".repeat(500)),
      "design/N1000.X.f64": Buffer.from(Float64Array.from({ length: 64 }, (_, i) => Math.sin(i)).buffer),
      "ringkasan×.md": Buffer.from("# ✓\n"),
      "empty.txt": Buffer.alloc(0),
    };
    for (const [rel, data] of Object.entries(files)) fs.writeFileSync(path.join(run, ...rel.split("/")), data);
    const zipPath = path.join(dir, "out.zip");
    const res = withModule<{ files: number; bytes: number; sha256: string }>(
      "benchDay.mjs",
      `console.log(JSON.stringify(m.writeZip(${JSON.stringify(run)}, ${JSON.stringify(zipPath)}, "dry-20261019-000000")));`
    );
    const buf = fs.readFileSync(zipPath);
    expect(res.files).toBe(5);
    expect(res.bytes).toBe(buf.length);
    expect(fs.existsSync(`${zipPath}.tmp`)).toBe(false);
    const entries = readZip(buf);
    expect([...entries.keys()].sort()).toEqual(Object.keys(files).map((k) => `dry-20261019-000000/${k}`).sort());
    for (const [rel, data] of Object.entries(files)) expect(entries.get(`dry-20261019-000000/${rel}`)!.equals(data)).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run pilot terbaru per mode (dry / bukan) dari day.json; ANSI dibuang untuk day.log", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "benchday-"));
  try {
    const put = (id: string, day: object) => {
      fs.mkdirSync(path.join(dir, id));
      fs.writeFileSync(path.join(dir, id, "day.json"), JSON.stringify(day));
    };
    const pilot = (startedAt: string, ran = true) => ({ pilot: { startedAt, steps: ran ? { preflight: { exitCode: 0 }, orchestrator: { exitCode: 0 } } : { preflight: { exitCode: 1 } } } });
    put("20261019-010000", { dry: false, phases: pilot("2026-10-19T01:00:00Z") });
    put("20261019-020000", { dry: false, phases: pilot("2026-10-19T02:00:00Z") });
    put("20261019-030000", { dry: false, phases: pilot("2026-10-19T03:00:00Z", false) }); // preflight merah
    put("dry-20261019-040000", { dry: true, phases: pilot("2026-10-19T04:00:00Z") });
    const r = benchDay<(string | null)[]>(
      `[m.latestPilotRun(${JSON.stringify(dir)}, false), m.latestPilotRun(${JSON.stringify(dir)}, true), m.stripAnsi("  \\x1b[32m[HIJAU ]\\x1b[0m Daya")]`
    );
    expect(r).toEqual(["20261019-020000", "dry-20261019-040000", "  [HIJAU ] Daya"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validateRun --role pilot: sesi peran lain tidak dianggap hilang", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-role-"));
  try {
    const schedule = [
      { id: "pilot-chrome", role: "pilot", browser: "chrome", dir: "chrome/pilot-01" },
      { id: "chrome-01", role: "measure", browser: "chrome", dir: "chrome/measure-01" },
    ];
    const config = { lifecycle: "interleaved", repetitions: 2, sizes: [1000], workloads: ["core"] };
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: "t", config, schedule }));
    const r = withModule<string[][]>(
      "validateRun.mjs",
      `console.log(JSON.stringify([m.validateRun(${JSON.stringify(dir)}, { role: "pilot" }).violations, m.validateRun(${JSON.stringify(dir)}).violations]));`
    );
    expect(r).toEqual([["run: sessions without output: pilot-chrome"], ["run: sessions without output: pilot-chrome, chrome-01"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
