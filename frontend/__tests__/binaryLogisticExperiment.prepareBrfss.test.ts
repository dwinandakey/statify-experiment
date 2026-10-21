/**
 * Skrip persiapan dataset BRFSS (scripts/prepareBrfss.mjs, eksperimen v2):
 * - salinan mulberry32/shuffleInPlace di skrip identik dengan services/prng.ts;
 * - validasi header, jumlah baris, dan nilai; label GenHlth; prefix tanpa kategori ditolak;
 * - experiment-data/brfss_bench_100k.csv yang di-commit cocok dengan manifest-nya;
 * - bila file mentah ada di experiment-data/raw/, menjalankan ulang skrip menghasilkan byte yang sama.
 * Skrip berupa ES module, jadi dijalankan di proses Node terpisah.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32, shuffleInPlace } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prng";

const repo = path.join(__dirname, "../..");
const script = path.join(__dirname, "../components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/prepareBrfss.mjs");
const dataDir = path.join(repo, "experiment-data");
const rawPath = path.join(dataDir, "raw/diabetes_binary_health_indicators_BRFSS2015.csv");

/**
 * Jalankan `body` (ES module) yang mengimpor skrip sebagai `m`, kembalikan JSON yang dicetaknya.
 * Kode dikirim lewat stdin, bukan `-e`, karena batas panjang baris perintah Windows (~32 KB).
 */
function withModule<T>(body: string): T {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(script).href)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module"], { input: code, encoding: "utf8" });
  return JSON.parse(out) as T;
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

describe("prepareBrfss.mjs: PRNG", () => {
  test("mulberry32 dan shuffleInPlace identik dengan services/prng.ts", () => {
    const fromScript = withModule<{ draws: number[]; perm: number[] }>(`
      const r = m.mulberry32(42);
      const draws = Array.from({ length: 50 }, () => r());
      const perm = m.shuffleInPlace(Array.from({ length: 1000 }, (_, i) => i), m.mulberry32(42));
      console.log(JSON.stringify({ draws, perm }));
    `);
    const r = mulberry32(42);
    expect(fromScript.draws).toEqual(Array.from({ length: 50 }, () => r()));
    expect(fromScript.perm).toEqual(shuffleInPlace(Array.from({ length: 1000 }, (_, i) => i), mulberry32(42)));
  });
});

describe("prepareBrfss.mjs: validasi dan transformasi", () => {
  const header =
    "Diabetes_binary,HighBP,HighChol,CholCheck,BMI,Smoker,Stroke,HeartDiseaseorAttack,PhysActivity,Fruits,Veggies," +
    "HvyAlcoholConsump,AnyHealthcare,NoDocbcCost,GenHlth,MentHlth,PhysHlth,DiffWalk,Sex,Age,Education,Income";
  // GenHlth = kolom ke-15 (indeks 14)
  const row = (y: number, genHlth: number) =>
    `${y}.0,1.0,0.0,1.0,40.0,1.0,0.0,0.0,1.0,0.0,1.0,0.0,1.0,0.0,${genHlth}.0,18.0,15.0,1.0,0.0,9.0,4.0,3.0`;

  const run = (text: string, expectedRows: number) =>
    withModule<{ rows?: string[][]; error?: string }>(`
      try { console.log(JSON.stringify({ rows: m.parseKaggle(${JSON.stringify(text)}, ${expectedRows}) })); }
      catch (e) { console.log(JSON.stringify({ error: e.message })); }
    `);

  test("kolom terpilih, angka ditulis ulang tanpa .0, GenHlth menjadi label berurutan", () => {
    const { rows } = run([header, row(1, 5), row(0, 2)].join("\r\n") + "\r\n", 2);
    expect(rows).toEqual([
      ["1", "1", "0", "40", "1", "0", "9", "3", "5_poor"],
      ["0", "1", "0", "40", "1", "0", "9", "3", "2_very_good"],
    ]);
    // Urutan localeCompare label = urutan kode, jadi kategori terakhir (referensi) = 5_poor
    const labels = ["5_poor", "1_excellent", "4_fair", "3_good", "2_very_good"];
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(["1_excellent", "2_very_good", "3_good", "4_fair", "5_poor"]);
  });

  test("header, jumlah baris, dan nilai di luar codebook ditolak dengan pesan jelas", () => {
    expect(run([header.replace("GenHlth", "GenHealth"), row(0, 1)].join("\n"), 1).error).toMatch(/Missing: GenHlth\. Unexpected: GenHealth/);
    expect(run([header, row(0, 1)].join("\n"), 253680).error).toMatch(/Expected 253,680 data rows, found 1/);
    expect(run([header, row(0, 6)].join("\n"), 1).error).toMatch(/Row 2, column GenHlth: invalid value "6\.0"/);
    expect(run([header, row(2, 1)].join("\n"), 1).error).toMatch(/column Diabetes_binary: invalid value "2\.0"/);
  });

  test("prefix yang kehilangan kategori GenHlth ditolak (p akan berubah)", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(i % 7 === 0 ? 1 : 0, 1 + (i % 4)));
    const out = withModule<{ error?: string }>(`
      try { m.prepare(${JSON.stringify([header, ...rows].join("\n"))}, { expectedRows: 1200, outputRows: 1200 }); console.log("{}"); }
      catch (e) { console.log(JSON.stringify({ error: e.message })); }
    `);
    expect(out.error).toMatch(/Prefix N = 1000 lacks GenHlth category 5_poor/);
  });
});

describe("experiment-data/brfss_bench_100k.csv", () => {
  const csvPath = path.join(dataDir, "brfss_bench_100k.csv");
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "brfss_bench_100k.manifest.json"), "utf8"));

  test("cocok dengan manifest: SHA-256, 100.000 baris, kolom, seed", () => {
    const bytes = fs.readFileSync(csvPath);
    expect(sha256(bytes)).toBe(manifest.output.sha256);
    const lines = bytes.toString("utf8").trimEnd().split("\n");
    expect(lines[0]).toBe("Diabetes_binary,HighBP,HighChol,BMI,PhysActivity,Sex,Age,Income,GenHlth");
    expect(lines).toHaveLength(1 + 100_000);
    expect(manifest.output.columns).toEqual(lines[0].split(","));
    expect(manifest.shuffle).toMatchObject({ prng: "mulberry32", seed: 42 });
    expect(manifest.model.p).toBe(12);
    expect(manifest.source.rows).toBe(253_680);
  });

  (fs.existsSync(rawPath) ? test : test.skip)("dibuat ulang dari file mentah: byte identik", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brfss-"));
    try {
      execFileSync(process.execPath, [script, rawPath, "--out-dir", outDir], { encoding: "utf8" });
      expect(sha256(fs.readFileSync(path.join(outDir, "brfss_bench_100k.csv")))).toBe(manifest.output.sha256);
      const again = JSON.parse(fs.readFileSync(path.join(outDir, "brfss_bench_100k.manifest.json"), "utf8"));
      expect(again.source.sha256).toBe(manifest.source.sha256);
      expect(again.statistics).toEqual(manifest.statistics);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
