// Production build eksperimen dengan commit tercatat, lintas-OS (Windows, Linux, macOS).
//
//   npm run build:experiment                hash artefak, cek working tree, lalu next build
//   npm run build:experiment -- --dry-run   tampilkan NEXT_PUBLIC_GIT_COMMIT dan keputusan build
//                                           tanpa menulis file dan tanpa build (exit 1 bila build
//                                           akan ditolak)
//
// Langkah:
// 1. scripts/hashArtifacts.mjs memperbarui ARTIFACT_HASHES.json (SHA-256 artefak yang diukur).
// 2. NEXT_PUBLIC_GIT_COMMIT = `git describe --always --dirty --abbrev=8`. Nilai ini SELALU menimpa
//    variabel yang sudah ada di environment: nilai lama yang tertinggal di terminal pernah terbawa
//    ke meta.json batch artikel v1 (reproducibility/REPRODUCE.md §3).
// 3. Build ditolak (exit 1) bila working tree dirty, yaitu ada perubahan pada file yang dilacak git
//    (definisi `git describe --dirty`; file untracked tidak dihitung), kecuali
//    EXPERIMENT_ALLOW_DIRTY=1. Karena langkah 1 berjalan lebih dulu, artefak yang berubah tanpa
//    ARTIFACT_HASHES.json baru yang di-commit juga menggagalkan build.
// 4. frontend/next-env.d.ts dilacak git tetapi ditulis ulang oleh next dev/build (referensi distDir
//    .next vs .next-dev). File buatan Next ini dikembalikan ke versi HEAD sebelum cek dan sesudah
//    build, supaya tidak membuat working tree dirty.
// 5. Setelah build sukses, .next/EXPERIMENT_BUILD.json mencatat gitCommit, commit HEAD lengkap, dan
//    BUILD_ID Next. Preflight hari-H memakainya untuk memastikan build = HEAD dan tidak dirty, dan
//    orkestrator mencatatnya di run.json dan session.json.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const hashScript = resolve(here, "hashArtifacts.mjs");
const dryRun = process.argv.includes("--dry-run");
const allowDirty = process.env.EXPERIMENT_ALLOW_DIRTY === "1";
const NEXT_ENV = "next-env.d.ts";

// trimEnd, bukan trim: kolom status `git status --porcelain` diawali spasi
const git = (...args) => execFileSync("git", args, { cwd: frontend, encoding: "utf8" }).trimEnd();
const describe = () => git("describe", "--always", "--dirty", "--abbrev=8");

/** File terlacak yang berubah (staged atau belum), format `git status --porcelain`, path dari root repo. */
const changedTracked = () =>
  git("status", "--porcelain", "--untracked-files=no")
    .split(/\r?\n/)
    .filter(Boolean);
const isNextEnv = (line) => line.endsWith(`frontend/${NEXT_ENV}`);

/** Cetak nilai yang dipakai; nilai lama di environment diabaikan (lihat langkah 2). */
function announce(commit) {
  const stale = process.env.NEXT_PUBLIC_GIT_COMMIT;
  if (stale && stale !== commit) console.warn(`Ignoring NEXT_PUBLIC_GIT_COMMIT=${stale} from the environment.`);
  console.log(`NEXT_PUBLIC_GIT_COMMIT=${commit}`);
}

/** Kembalikan next-env.d.ts ke versi HEAD bila berubah (hanya bila file itu dilacak git). */
function restoreNextEnv(when) {
  if (!git("ls-files", "--", NEXT_ENV) || !git("status", "--porcelain", "--", NEXT_ENV)) return;
  git("restore", "--source=HEAD", "--staged", "--worktree", "--", NEXT_ENV);
  console.log(`Restored frontend/${NEXT_ENV} to HEAD (${when}); Next.js rewrites it on every build.`);
}

if (dryRun) {
  // Tanpa menulis apa pun: perkirakan keputusan build seperti langkah 1–4 di atas
  const hashCheck = spawnSync(process.execPath, [hashScript, "--check"], { cwd: frontend, encoding: "utf8" });
  const changed = changedTracked();
  const blocking = changed.filter((line) => !isNextEnv(line));
  announce(describe());
  if (changed.some(isNextEnv)) console.log(`frontend/${NEXT_ENV} is modified; the build restores it to HEAD first.`);
  if (hashCheck.status !== 0) console.log("ARTIFACT_HASHES.json is outdated; the build rewrites it (tree becomes dirty).");
  if (blocking.length > 0) console.log(`Modified tracked files:\n${blocking.map((f) => `  ${f}`).join("\n")}`);
  const refuse = (blocking.length > 0 || hashCheck.status !== 0) && !allowDirty;
  console.log(refuse ? "The build would be refused (dirty working tree)." : "The build would proceed.");
  process.exit(refuse ? 1 : 0);
}

// 1. Hash artefak
const hash = spawnSync(process.execPath, [hashScript], { cwd: frontend, stdio: "inherit" });
if (hash.status !== 0) process.exit(hash.status ?? 1);

// 2–3. Commit tercatat dan cek working tree
restoreNextEnv("before the build");
const commit = describe();
if (commit.endsWith("-dirty")) {
  const changed = changedTracked();
  if (!allowDirty) {
    console.error(`Refusing to build: the working tree has uncommitted changes (${commit}):`);
    console.error(changed.map((f) => `  ${f}`).join("\n"));
    console.error("Commit or stash them, or set EXPERIMENT_ALLOW_DIRTY=1 to build anyway (recorded with -dirty).");
    process.exit(1);
  }
  console.warn(`EXPERIMENT_ALLOW_DIRTY=1: building from a dirty working tree (${changed.length} changed file(s)).`);
}
announce(commit);

// 4. next build, lalu next-env.d.ts dikembalikan
const nextBin = createRequire(resolve(frontend, "package.json")).resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: frontend,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_GIT_COMMIT: commit },
});
restoreNextEnv("after the build");

// 5. Info build (distDir production = .next, lihat next.config.js)
if (result.status === 0) {
  const dist = join(frontend, ".next");
  const info = {
    gitCommit: commit,
    gitHead: git("rev-parse", "HEAD"),
    nextBuildId: readFileSync(join(dist, "BUILD_ID"), "utf8").trim(),
    builtAt: new Date().toISOString(),
    allowDirty,
  };
  writeFileSync(join(dist, "EXPERIMENT_BUILD.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`Wrote .next/EXPERIMENT_BUILD.json (${info.gitCommit}, BUILD_ID ${info.nextBuildId}).`);
}
process.exit(result.status ?? 1);
