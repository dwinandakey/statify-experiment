/**
 * Artefak yang diukur dan build yang bisa direproduksi (eksperimen v2, Tugas 1):
 * - ARTIFACT_HASHES.json sesuai dengan file di public/workers/Regression/BinaryExperiment
 *   (scripts/hashArtifacts.mjs --check);
 * - paket wasm tetap biner yang diukur sejak v1. Bila paket sengaja dibangun ulang, perbarui
 *   MEASURED_WASM_SHA256 di sini bersama ARTIFACT_HASHES.json;
 * - scripts/build-experiment.mjs --dry-run: NEXT_PUBLIC_GIT_COMMIT berasal dari
 *   `git describe --always --dirty --abbrev=8` (nilai lama di environment diabaikan) dan
 *   build ditolak hanya bila ada file terlacak yang berubah, kecuali EXPERIMENT_ALLOW_DIRTY=1.
 * Skrip dijalankan di proses Node terpisah karena berupa ES module (sama seperti uji paritas).
 */
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const manifestPath = path.join(frontend, "public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json");
const MEASURED_WASM_SHA256 = "3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d";
const ARTIFACTS = [
  "pkg/statify_logistic_bg.wasm",
  "pkg/statify_logistic.js",
  "irls_core.js",
  "logistic_enter.js",
  "jsCore.worker.js",
  "wasmCore.worker.js",
];

function runScript(name, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(frontend, "scripts", name), ...args], {
    cwd: frontend,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function gitOrNull(...args) {
  try {
    return execFileSync("git", args, { cwd: frontend, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

describe("ARTIFACT_HASHES.json", () => {
  test("sesuai dengan artefak di disk (hashArtifacts --check)", () => {
    const r = runScript("hashArtifacts.mjs", ["--check"]);
    expect(r.stdout).toContain("ARTIFACT_HASHES.json is up to date.");
    expect(r.status).toBe(0);
  });

  test("memuat keenam artefak, dan paket wasm adalah biner yang diukur", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.algorithm).toBe("sha256");
    expect(Object.keys(manifest.files).sort()).toEqual([...ARTIFACTS].sort());
    expect(manifest.files["pkg/statify_logistic_bg.wasm"].sha256).toBe(MEASURED_WASM_SHA256);
    for (const rel of ARTIFACTS) expect(manifest.files[rel].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

const inGitRepo = gitOrNull("rev-parse", "--is-inside-work-tree") === "true";

(inGitRepo ? describe : describe.skip)("build-experiment --dry-run", () => {
  test("NEXT_PUBLIC_GIT_COMMIT = git describe --always --dirty --abbrev=8; nilai lama di environment diabaikan", () => {
    const r = runScript("build-experiment.mjs", ["--dry-run"], {
      EXPERIMENT_ALLOW_DIRTY: "1",
      NEXT_PUBLIC_GIT_COMMIT: "stale-value-from-terminal",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`NEXT_PUBLIC_GIT_COMMIT=${gitOrNull("describe", "--always", "--dirty", "--abbrev=8")}\n`);
    expect(r.stderr).toContain("Ignoring NEXT_PUBLIC_GIT_COMMIT=stale-value-from-terminal from the environment.");
  });

  test("tanpa EXPERIMENT_ALLOW_DIRTY build ditolak tepat bila working tree dirty", () => {
    // next-env.d.ts tidak dihitung: build mengembalikannya ke HEAD sebelum cek
    const changed = gitOrNull("status", "--porcelain", "--untracked-files=no")
      .split(/\r?\n/)
      .filter((line) => line && !line.endsWith("frontend/next-env.d.ts"));
    const manifestOutdated = runScript("hashArtifacts.mjs", ["--check"]).status !== 0;
    const r = runScript("build-experiment.mjs", ["--dry-run"], { EXPERIMENT_ALLOW_DIRTY: "" });
    expect(r.status).toBe(changed.length > 0 || manifestOutdated ? 1 : 0);
  });
});
