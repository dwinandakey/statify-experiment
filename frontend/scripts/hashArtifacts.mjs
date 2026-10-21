// SHA-256 artefak eksperimen yang diukur, lintas-OS (Windows, Linux, macOS).
//
//   node scripts/hashArtifacts.mjs           tulis public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json
//   node scripts/hashArtifacts.mjs --check   bandingkan dengan ARTIFACT_HASHES.json tanpa menulis
//                                            (exit 1 bila file itu belum ada atau berbeda)
//
// Dijalankan otomatis oleh `npm run build:experiment` sebelum cek working tree, jadi artefak
// yang berubah tanpa ARTIFACT_HASHES.json baru yang di-commit membuat build ditolak.
//
// File .wasm di-hash byte demi byte. File teks di-hash setelah CRLF → LF: repo memakai
// core.autocrlf=true, sehingga byte di disk bergantung pada OS dan kapan file di-checkout (di
// mesin build asli irls_core.js tersimpan CRLF, logistic_enter.js LF). Setelah normalisasi,
// nilainya sama dengan isi blob git (`git show HEAD:<path> | sha256sum`) di semua OS. Isi JSON
// deterministik (tanpa waktu dan path absolut) dan hanya ditulis bila berubah, jadi menjalankan
// ulang skrip ini tanpa perubahan artefak tidak membuat working tree dirty.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const artifactDir = join(frontend, "public/workers/Regression/BinaryExperiment");
const manifestPath = join(artifactDir, "ARTIFACT_HASHES.json");
const check = process.argv.includes("--check");

// Artefak yang diukur, relatif terhadap artifactDir
const ARTIFACTS = [
  "pkg/statify_logistic_bg.wasm",
  "pkg/statify_logistic.js",
  "irls_core.js",
  "logistic_enter.js",
  "jsCore.worker.js",
  "wasmCore.worker.js",
];

const toLf = (text) => text.replace(/\r\n/g, "\n");

function digest(rel) {
  const raw = readFileSync(join(artifactDir, rel));
  // latin1 memetakan setiap byte ke tepat satu karakter, jadi hanya pasangan CRLF yang berubah
  const content = rel.endsWith(".wasm") ? raw : Buffer.from(toLf(raw.toString("latin1")), "latin1");
  return { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
}

const manifest = {
  description:
    "SHA-256 artefak eksperimen yang diukur, dibuat oleh frontend/scripts/hashArtifacts.mjs " +
    "(npm run build:experiment); jangan diedit manual. File teks di-hash setelah CRLF → LF " +
    "(sama dengan isi blob git di semua OS), file .wasm byte demi byte. bytes = panjang isi yang di-hash.",
  algorithm: "sha256",
  files: Object.fromEntries(ARTIFACTS.map((rel) => [rel, digest(rel)])),
};
const json = JSON.stringify(manifest, null, 2) + "\n";
const current = existsSync(manifestPath) ? toLf(readFileSync(manifestPath, "utf8")) : null;

for (const [rel, { sha256 }] of Object.entries(manifest.files)) console.log(`${sha256}  ${rel}`);

if (check) {
  const same = current === json;
  console.log(
    same
      ? "ARTIFACT_HASHES.json is up to date."
      : "ARTIFACT_HASHES.json is missing or outdated: run `node scripts/hashArtifacts.mjs` and commit it."
  );
  process.exit(same ? 0 : 1);
}

if (current === json) {
  console.log("ARTIFACT_HASHES.json unchanged.");
} else {
  writeFileSync(manifestPath, json);
  console.log(`Wrote ${manifestPath}`);
}
