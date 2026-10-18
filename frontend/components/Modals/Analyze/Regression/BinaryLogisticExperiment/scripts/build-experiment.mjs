// Production build dengan commit tercatat, lintas-OS (Windows, Linux, macOS).
//
//   npm run build:experiment              next build dengan NEXT_PUBLIC_GIT_COMMIT = HEAD
//   npm run build:experiment -- --dry-run tampilkan nilai yang akan dipakai tanpa build
//
// Nilai NEXT_PUBLIC_GIT_COMMIT SELALU ditimpa dari `git rev-parse --short HEAD`, supaya
// variabel lama yang tertinggal di terminal tidak terbawa ke meta.json (kolom gitCommit).
// Bila ada perubahan pada file yang dilacak git, nilainya diberi akhiran "-dirty".
// next-env.d.ts dikecualikan karena ditulis ulang oleh next build sendiri.
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "../../../../../..");
const git = (...args) => execFileSync("git", args, { cwd: frontend, encoding: "utf8" }).trim();

const sha = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no")
  .split(/\r?\n/)
  .filter((line) => line && !line.endsWith("next-env.d.ts"));
const commit = dirty.length > 0 ? `${sha}-dirty` : sha;

if (process.env.NEXT_PUBLIC_GIT_COMMIT && process.env.NEXT_PUBLIC_GIT_COMMIT !== commit) {
  console.warn(`Ignoring NEXT_PUBLIC_GIT_COMMIT=${process.env.NEXT_PUBLIC_GIT_COMMIT} from the environment.`);
}
console.log(`NEXT_PUBLIC_GIT_COMMIT=${commit}${dirty.length ? ` (uncommitted changes: ${dirty.length} file(s))` : ""}`);
if (process.argv.includes("--dry-run")) process.exit(0);

const nextBin = createRequire(resolve(frontend, "package.json")).resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: frontend,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_GIT_COMMIT: commit },
});
process.exit(result.status ?? 1);
