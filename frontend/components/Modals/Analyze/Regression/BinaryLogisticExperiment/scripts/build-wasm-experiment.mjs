// Build paket wasm eksperimen, lintas-OS (Windows, Linux, macOS).
//
//   npm run build:wasm:experiment             build lalu salin ke public/.../BinaryExperiment/pkg
//   npm run build:wasm:experiment -- --check  build lalu bandingkan SHA-256 dengan pkg yang
//                                             ter-commit, tanpa menyalin (exit 1 bila berbeda)
//
// Menjalankan `wasm-pack build --target web --release --out-dir target/experiment-pkg` di crate
// BinaryLogistic/rust. Toolchain dikunci rust-toolchain.toml (1.91.1) dan dependensi oleh
// Cargo.lock. Biner byte-identik hanya bila dibangun di path yang sama: rustc menanam path
// absolut sumber dependensi (mis. ~/.cargo/registry/...) di pesan panic.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "../../../../../..");
const crate = join(frontend, "components/Modals/Analyze/Regression/BinaryLogistic/rust");
const outDir = join(crate, "target/experiment-pkg");
const pkgDir = join(frontend, "public/workers/Regression/BinaryExperiment/pkg");
const check = process.argv.includes("--check");

const result = spawnSync("wasm-pack", ["build", "--target", "web", "--release", "--out-dir", "target/experiment-pkg"], {
  cwd: crate,
  stdio: "inherit",
});
if (result.error) {
  console.error(`Cannot run wasm-pack (${result.error.message}). Install it: cargo install wasm-pack --version 0.13.1 --locked`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const files = readdirSync(outDir).filter((f) => f.startsWith("statify_logistic"));
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

if (check) {
  let differs = 0;
  for (const f of files) {
    const committed = join(pkgDir, f);
    const built = sha256(join(outDir, f));
    const same = existsSync(committed) && sha256(committed) === built;
    if (!same) differs++;
    console.log(`${same ? "identical" : "DIFFERS  "}  ${f}  ${built}`);
  }
  console.log(
    differs === 0
      ? "Rebuilt package is byte-identical to the committed one."
      : "Rebuilt package differs. Expected on another machine (embedded source paths); compare behaviour with checkEnterParity.mjs and the Jest golden tests."
  );
  process.exit(differs === 0 ? 0 : 1);
}

mkdirSync(pkgDir, { recursive: true });
for (const f of files) copyFileSync(join(outDir, f), join(pkgDir, f));
console.log(`Copied ${files.length} files to ${pkgDir}`);
