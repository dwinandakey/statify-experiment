// Persiapan dataset eksperimen v2: CDC Diabetes Health Indicators (BRFSS 2015).
//
// Sumber: Kaggle `diabetes_binary_health_indicators_BRFSS2015.csv` (253.680 baris, 22 kolom;
// dataset yang sama di UCI, doi:10.24432/C53919). File mentah tidak di-commit
// (experiment-data/raw/ ada di .gitignore).
//
// Jalankan dari root repo (Node >= 18, tanpa dependency):
//   node frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/prepareBrfss.mjs \
//     experiment-data/raw/diabetes_binary_health_indicators_BRFSS2015.csv [--out-dir experiment-data]
//
// Langkah:
// 1. Validasi: header persis 22 kolom Kaggle, tepat 253.680 baris data, nilai setiap kolom
//    terpilih berada di rentang codebook (gagal dengan pesan jelas bila tidak).
// 2. Kolom: Diabetes_binary (dependen); HighBP, HighChol, BMI, PhysActivity, Sex, Age, Income
//    (numerik); GenHlth (kategorik). Angka ditulis ulang dalam bentuk desimal terpendek
//    (40.0 → 40, nilainya sama). GenHlth 1–5 menjadi label teks "1_excellent" … "5_poor" supaya
//    import CSV Statify menandainya nominal (kolom yang semua isinya angka menjadi scale);
//    urutan localeCompare label sama dengan urutan kode, jadi coding Indicator/Last memakai
//    "5_poor" sebagai referensi dan p = 1 + 7 + 4 = 12.
// 3. Semua baris diacak dengan Fisher–Yates (shuffleInPlace) memakai mulberry32 seed 42, salinan
//    persis services/prng.ts (dicek test Jest binaryLogisticExperiment.prepareBrfss), lalu
//    100.000 baris pertama ditulis ke brfss_bench_100k.csv (LF, disimpan byte demi byte lewat
//    experiment-data/.gitattributes supaya SHA-256 sama di semua OS).
// 4. brfss_bench_100k.manifest.json: SHA-256 input/output, seed, kolom, jumlah baris,
//    prevalensi Diabetes_binary, frekuensi GenHlth (input, output, dan prefix N = 1.000, 10.000,
//    50.000, 100.000 yang dipakai batch), tanggal pembuatan. Skrip gagal bila suatu prefix
//    kehilangan kategori GenHlth atau salah satu kelas Y (p akan berubah).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXPECTED_ROWS = 253_680;
export const OUTPUT_ROWS = 100_000;
export const SEED = 42;
export const PREFIX_SIZES = [1_000, 10_000, 50_000, 100_000];

/** Header file Kaggle, persis dan berurutan. */
export const KAGGLE_COLUMNS = [
  "Diabetes_binary", "HighBP", "HighChol", "CholCheck", "BMI", "Smoker", "Stroke",
  "HeartDiseaseorAttack", "PhysActivity", "Fruits", "Veggies", "HvyAlcoholConsump",
  "AnyHealthcare", "NoDocbcCost", "GenHlth", "MentHlth", "PhysHlth", "DiffWalk", "Sex",
  "Age", "Education", "Income",
];

export const DEPENDENT = "Diabetes_binary";
export const NUMERIC_COVARIATES = ["HighBP", "HighChol", "BMI", "PhysActivity", "Sex", "Age", "Income"];
export const CATEGORICAL_COVARIATE = "GenHlth";
export const OUTPUT_COLUMNS = [DEPENDENT, ...NUMERIC_COVARIATES, CATEGORICAL_COVARIATE];

export const GENHLTH_LABELS = { 1: "1_excellent", 2: "2_very_good", 3: "3_good", 4: "4_fair", 5: "5_poor" };

/** Rentang nilai sah menurut codebook BRFSS 2015 versi Kaggle (semua bilangan bulat). */
const VALID = {
  Diabetes_binary: (v) => v === 0 || v === 1,
  HighBP: (v) => v === 0 || v === 1,
  HighChol: (v) => v === 0 || v === 1,
  BMI: (v) => Number.isInteger(v) && v >= 1 && v <= 200,
  PhysActivity: (v) => v === 0 || v === 1,
  Sex: (v) => v === 0 || v === 1,
  Age: (v) => Number.isInteger(v) && v >= 1 && v <= 13,
  Income: (v) => Number.isInteger(v) && v >= 1 && v <= 8,
  GenHlth: (v) => Number.isInteger(v) && v >= 1 && v <= 5,
};

// --- Salinan persis services/prng.ts (dicek kesamaannya oleh test Jest) ---

export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

// --- Pipeline ---

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

class PrepareError extends Error {}

/** Parse + validasi CSV Kaggle; mengembalikan baris keluaran (array string) sesuai urutan file. */
export function parseKaggle(text, expectedRows = EXPECTED_ROWS) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim());
  if (header.join(",") !== KAGGLE_COLUMNS.join(",")) {
    const missing = KAGGLE_COLUMNS.filter((c) => !header.includes(c));
    const extra = header.filter((c) => !KAGGLE_COLUMNS.includes(c));
    throw new PrepareError(
      `Unexpected header. Expected the 22 Kaggle columns ${KAGGLE_COLUMNS.join(",")}.` +
        (missing.length ? ` Missing: ${missing.join(", ")}.` : "") +
        (extra.length ? ` Unexpected: ${extra.join(", ")}.` : "") +
        (!missing.length && !extra.length ? " Same columns, different order." : "")
    );
  }
  if (lines.length !== expectedRows) {
    throw new PrepareError(`Expected ${expectedRows.toLocaleString("en-US")} data rows, found ${lines.length.toLocaleString("en-US")}.`);
  }
  const index = Object.fromEntries(OUTPUT_COLUMNS.map((c) => [c, KAGGLE_COLUMNS.indexOf(c)]));
  return lines.map((line, i) => {
    const cells = line.split(",");
    if (cells.length !== KAGGLE_COLUMNS.length) {
      throw new PrepareError(`Row ${i + 2}: expected ${KAGGLE_COLUMNS.length} fields, found ${cells.length}.`);
    }
    return OUTPUT_COLUMNS.map((col) => {
      const raw = cells[index[col]].trim();
      const v = Number(raw);
      if (raw === "" || !Number.isFinite(v) || !VALID[col](v)) {
        throw new PrepareError(`Row ${i + 2}, column ${col}: invalid value "${raw}".`);
      }
      return col === CATEGORICAL_COVARIATE ? GENHLTH_LABELS[v] : String(v);
    });
  });
}

/** Prevalensi Y dan frekuensi kategori GenHlth untuk sekumpulan baris keluaran. */
export function describeRows(rows) {
  const yCol = OUTPUT_COLUMNS.indexOf(DEPENDENT);
  const gCol = OUTPUT_COLUMNS.indexOf(CATEGORICAL_COVARIATE);
  let positives = 0;
  const genHlth = Object.fromEntries(Object.values(GENHLTH_LABELS).map((label) => [label, 0]));
  for (const r of rows) {
    if (r[yCol] === "1") positives++;
    genHlth[r[gCol]]++;
  }
  return { rows: rows.length, diabetesPositive: positives, prevalence: positives / rows.length, genHlth };
}

export function toCsv(rows) {
  return [OUTPUT_COLUMNS.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

export function prepare(inputText, { seed = SEED, outputRows = OUTPUT_ROWS, expectedRows = EXPECTED_ROWS } = {}) {
  const rows = parseKaggle(inputText, expectedRows);
  const order = shuffleInPlace(
    Array.from({ length: rows.length }, (_, i) => i),
    mulberry32(seed)
  );
  const output = order.slice(0, outputRows).map((i) => rows[i]);
  const prefixes = {};
  for (const N of PREFIX_SIZES.filter((s) => s <= output.length)) {
    const d = describeRows(output.slice(0, N));
    const emptyCategory = Object.entries(d.genHlth).find(([, count]) => count === 0);
    if (emptyCategory || d.diabetesPositive === 0 || d.diabetesPositive === N) {
      throw new PrepareError(
        `Prefix N = ${N} lacks ${emptyCategory ? `GenHlth category ${emptyCategory[0]}` : "one class of Diabetes_binary"}; p would change.`
      );
    }
    prefixes[N] = d;
  }
  return { csv: toCsv(output), input: describeRows(rows), output: describeRows(output), prefixes };
}

function main() {
  const args = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, "../../../../../../..");
  const outIdx = args.indexOf("--out-dir");
  const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : join(repo, "experiment-data"));
  const positional = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
  const inputPath = resolve(positional[0] ?? join(repo, "experiment-data/raw/diabetes_binary_health_indicators_BRFSS2015.csv"));

  let inputBytes;
  try {
    inputBytes = readFileSync(inputPath);
  } catch (err) {
    throw new PrepareError(`Cannot read input ${inputPath}: ${err.message}`);
  }
  const result = prepare(inputBytes.toString("utf8"));
  const csvBytes = Buffer.from(result.csv, "utf8");

  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, "brfss_bench_100k.csv");
  const manifestPath = join(outDir, "brfss_bench_100k.manifest.json");
  writeFileSync(csvPath, csvBytes);

  const manifest = {
    description:
      "Dataset benchmark eksperimen v2 (Binary Logistic Experiment), dibuat oleh " +
      "frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/prepareBrfss.mjs.",
    source: {
      name: "CDC Diabetes Health Indicators (BRFSS 2015), Kaggle diabetes_binary_health_indicators_BRFSS2015.csv",
      doi: "10.24432/C53919",
      file: basename(inputPath),
      sha256: sha256(inputBytes),
      rows: EXPECTED_ROWS,
      columns: KAGGLE_COLUMNS,
    },
    output: {
      file: basename(csvPath),
      sha256: sha256(csvBytes),
      bytes: csvBytes.length,
      rows: OUTPUT_ROWS,
      columns: OUTPUT_COLUMNS,
      lineEnding: "LF",
    },
    shuffle: {
      algorithm: "Fisher–Yates over all input rows (shuffleInPlace, services/prng.ts)",
      prng: "mulberry32",
      seed: SEED,
      selection: `first ${OUTPUT_ROWS} rows of the shuffled order`,
    },
    model: {
      dependent: DEPENDENT,
      numericCovariates: NUMERIC_COVARIATES,
      categoricalCovariate: CATEGORICAL_COVARIATE,
      genHlthLabels: GENHLTH_LABELS,
      coding: "Indicator, reference Last = 5_poor",
      p: 1 + NUMERIC_COVARIATES.length + Object.keys(GENHLTH_LABELS).length - 1,
    },
    numericFormat: "angka ditulis ulang dalam bentuk desimal terpendek (mis. 40.0 → 40); nilainya tidak berubah",
    statistics: { input: result.input, output: result.output, prefixes: result.prefixes },
    generatedAt: new Date().toISOString(),
    node: process.version,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Input  ${inputPath}\n       sha256 ${manifest.source.sha256}, ${EXPECTED_ROWS} rows`);
  console.log(`Output ${csvPath}\n       sha256 ${manifest.output.sha256}, ${OUTPUT_ROWS} rows, ${csvBytes.length} bytes`);
  console.log(`Prevalence Diabetes_binary: input ${result.input.prevalence.toFixed(5)}, output ${result.output.prevalence.toFixed(5)}`);
  console.log(`GenHlth (output): ${JSON.stringify(result.output.genHlth)}`);
  console.log(`Manifest ${manifestPath}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof PrepareError ? `prepareBrfss: ${err.message}` : err);
    process.exit(1);
  }
}
