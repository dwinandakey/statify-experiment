/**
 * Unit test persiapan data eksperimen Binary Logistic (Experiment):
 * listwise deletion, encoding Y (salinan processDependentVariable produksi),
 * dummy coding kategorik Indicator (Last) seperti pipeline produksi, dan
 * resampling ber-seed.
 */
import type { Variable } from "@/types/Variable";
import fs from "node:fs";
import path from "node:path";
import {
  checkSizes,
  encodeCategorical,
  encodeDependent,
  prefixFull,
  prepareExperimentData,
  resample,
  resampleFull,
  sampleDataset,
  sampleFull,
  takePrefix,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prepareData";
import {
  cellOrderRng,
  deriveSeed,
  mulberry32,
  shuffleInPlace,
  shuffledSizes,
  shuffledWorkloads,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prng";
import { normalizeBatchSettings } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/settings";
import { CELLS, cellsFor } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/types/experiment";
import { sizeOrderFor } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/runner";

jest.mock("@/stores/useDataStore", () => ({ useDataStore: { getState: () => ({ data: [] }) } }));
jest.mock("@/stores/useVariableStore", () => ({ useVariableStore: { getState: () => ({ variables: [] }) } }));

function mkVar(id: number, columnIndex: number, name: string, measure: Variable["measure"] = "scale", type: Variable["type"] = "NUMERIC"): Variable {
  return {
    id,
    columnIndex,
    name,
    type,
    width: 8,
    decimals: 2,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure,
    role: "input",
  };
}

const vars = [mkVar(1, 0, "admit", "nominal"), mkVar(2, 1, "gre"), mkVar(3, 2, "gpa"), mkVar(4, 3, "rank", "ordinal"), mkVar(5, 4, "label", "nominal", "STRING")];

describe("encodeDependent (salinan processDependentVariable produksi)", () => {
  test("nilai pertama hasil sort string → 0", () => {
    expect(encodeDependent([0, 1, 1, 0]).yMap).toEqual({ "0": 0, "1": 1 });
    expect(encodeDependent(["Yes", "No", "Yes"]).yVector).toEqual([1, 0, 1]);
  });

  test("sort leksikografis: 10 < 9 sebagai string, sama seperti produksi", () => {
    const { yVector, yMap } = encodeDependent([9, 10, 10, 9]);
    expect(yMap).toEqual({ "10": 0, "9": 1 });
    expect(yVector).toEqual([1, 0, 0, 1]);
  });

  test("selain tepat 2 level → error", () => {
    expect(() => encodeDependent([1, 1, 1])).toThrow(/exactly 2 levels/);
    expect(() => encodeDependent([0, 1, 2])).toThrow(/Found: 3/);
  });
});

describe("prepareExperimentData", () => {
  const data = [
    [1, 380, 3.61, 3, "a"],
    [0, 660, 3.67, 3, "b"],
    [1, "", 4.0, 1, "c"], // gre kosong → dibuang
    [0, 640, null, 4, "d"], // gpa null → dibuang
    [1, 520, 2.93, 4, "e"],
    ["", 760, 3.0, 2, "f"], // y kosong → dibuang
    [0, "800", "4", 4, "g"], // string numerik → Number()
  ];

  test("listwise deletion, kolom intercept, dan urutan row-major", () => {
    const r = prepareExperimentData(data, vars, vars[0], [vars[1], vars[2]]);
    expect(r.n).toBe(4);
    expect(r.p).toBe(3);
    expect(r.nTotal).toBe(7);
    expect(r.nMissing).toBe(3);
    expect(r.featureNames).toEqual(["Constant", "gre", "gpa"]);
    expect(Array.from(r.X)).toEqual([1, 380, 3.61, 1, 660, 3.67, 1, 520, 2.93, 1, 800, 4]);
    expect(Array.from(r.y)).toEqual([1, 0, 1, 0]);
    expect(r.yEncoding).toEqual({ "0": 0, "1": 1 });
  });

  test("kovariat ordinal di-dummy Indicator (Last) di posisinya, setelah kovariat numerik", () => {
    const r = prepareExperimentData(data, vars, vars[0], [vars[1], vars[3]]);
    // gpa tidak dipilih, jadi baris gpa = null tetap ikut. Baris sisa: rank 3, 3, 4, 4, 4
    // → kategori 3, 4 → referensi 4 → satu dummy rank(1)
    expect(r.n).toBe(5);
    expect(r.featureNames).toEqual(["Constant", "gre", "rank(1)"]);
    expect(r.p).toBe(3);
    expect(Array.from(r.X)).toEqual([1, 380, 1, 1, 660, 1, 1, 640, 0, 1, 520, 0, 1, 800, 0]);
    expect(r.categoricalCodings).toEqual([
      {
        variable: "rank",
        categories: [
          { label: "3", code: 3, frequency: 2 },
          { label: "4", code: 4, frequency: 3 },
        ],
        dummyNames: ["rank(1)"],
      },
    ]);
  });

  test("STRING ber-ukuran scale ditolak; STRING nominal diterima sebagai kategorik", () => {
    const stringScale = mkVar(6, 4, "label2", "scale", "STRING");
    const varsWithScaleString = [...vars.slice(0, 4), stringScale];
    expect(() => prepareExperimentData(data, varsWithScaleString, vars[0], [stringScale])).toThrow(
      /string variable[\s\S]*Nominal or Ordinal/
    );
    const r = prepareExperimentData(data, vars, vars[0], [vars[4]]);
    expect(r.featureNames[0]).toBe("Constant");
    expect(r.categoricalCodings[0].variable).toBe("label");
  });

  test("nilai non-numerik pada kovariat scale ditolak", () => {
    const bad = [
      [1, 380, 3.6, 3, "a"],
      [0, "abc", 3.7, 3, "b"],
    ];
    expect(() => prepareExperimentData(bad, vars, vars[0], [vars[1]])).toThrow(/non-numeric value\(s\).*"abc" \(row 2\)/);
  });

  test("variabel dicari ulang lewat columnIndex/nama bila id berubah", () => {
    const stale = { ...vars[1], id: 999 };
    const r = prepareExperimentData(data, vars, vars[0], [stale]);
    expect(r.covariates[0].id).toBe(2);
  });

  test("validasi pilihan variabel", () => {
    expect(() => prepareExperimentData(data, vars, null, [vars[1]])).toThrow(/dependent/);
    expect(() => prepareExperimentData(data, vars, vars[0], [])).toThrow(/covariate/);
    expect(() => prepareExperimentData([], vars, vars[0], [vars[1]])).toThrow(/empty/);
  });
});

describe("encodeCategorical (aturan processCovariates + design_matrix::build produksi)", () => {
  const col = (cols: Float64Array[], j: number) => Array.from(cols[j]);

  test("kode numerik: urut numerik, kategori terakhir referensi", () => {
    const { columns, coding } = encodeCategorical([2, 1, 4, 3, 1, 4], "rank");
    expect(coding.categories.map((c) => c.label)).toEqual(["1", "2", "3", "4"]);
    expect(coding.dummyNames).toEqual(["rank(1)", "rank(2)", "rank(3)"]);
    expect(col(columns, 0)).toEqual([0, 1, 0, 0, 1, 0]); // rank = 1
    expect(col(columns, 1)).toEqual([1, 0, 0, 0, 0, 0]); // rank = 2
    expect(col(columns, 2)).toEqual([0, 0, 0, 1, 0, 0]); // rank = 3; rank = 4 semua 0
  });

  test("angka dalam teks diurutkan numerik (9 < 10), berbeda dengan encoding Y", () => {
    const { columns, coding } = encodeCategorical(["10", "9", "9"], "g");
    expect(coding.categories.map((c) => c.label)).toEqual(["9", "10"]);
    expect(col(columns, 0)).toEqual([0, 1, 1]);
  });

  test("teks: urutan localeCompare → kode indeks, referensi kategori terakhir", () => {
    const { columns, coding } = encodeCategorical(["low", "mid", "high", "low"], "grp");
    expect(coding.categories.map((c) => c.label)).toEqual(["high", "low", "mid"]);
    expect(coding.categories.map((c) => c.frequency)).toEqual([1, 2, 1]);
    expect(coding.dummyNames).toEqual(["grp(1)", "grp(2)"]);
    expect(col(columns, 0)).toEqual([0, 0, 1, 0]); // high
    expect(col(columns, 1)).toEqual([1, 0, 0, 1]); // low; mid = referensi
  });

  test('"1" dan "1.0" bernilai sama → satu kategori (seperti kunci f64 di Rust)', () => {
    const { coding } = encodeCategorical(["1", "1.0", "2"], "d");
    expect(coding.categories.map((c) => c.code)).toEqual([1, 2]);
    expect(coding.categories[0].frequency).toBe(2);
  });

  test("hanya satu kategori → error jelas", () => {
    expect(() => encodeCategorical(["a", "a"], "only")).toThrow(/only 1 category/);
  });
});

describe("resample", () => {
  const n = 5, p = 2;
  const X = Float64Array.from([1, 10, 1, 20, 1, 30, 1, 40, 1, 50]);
  const y = Float64Array.from([0, 1, 0, 1, 1]);

  test("targetN = n → data asli tanpa salinan", () => {
    const r = resample(X, y, n, p, n, 42);
    expect(r.resampled).toBe(false);
    expect(r.X).toBe(X);
    expect(r.y).toBe(y);
  });

  test("deterministik untuk seed sama, berbeda untuk seed lain", () => {
    const a = resample(X, y, n, p, 1000, 42);
    const b = resample(X, y, n, p, 1000, 42);
    const c = resample(X, y, n, p, 1000, 43);
    expect(a.resampled).toBe(true);
    expect(Array.from(a.X)).toEqual(Array.from(b.X));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
    expect(Array.from(a.X)).not.toEqual(Array.from(c.X));
  });

  test("setiap baris hasil adalah baris asli utuh (X dan y berpasangan)", () => {
    const r = resample(X, y, n, p, 500, 7);
    expect(r.X.length).toBe(500 * p);
    for (let i = 0; i < 500; i++) {
      const src = (r.X[i * p + 1] / 10) - 1;
      expect(Number.isInteger(src)).toBe(true);
      expect(r.X[i * p]).toBe(1);
      expect(r.y[i]).toBe(y[src]);
    }
  });

  test("ukuran tidak valid ditolak", () => {
    expect(() => resample(X, y, n, p, 0, 1)).toThrow(/Invalid target size/);
    expect(() => resample(X, y, n, p, 2.5, 1)).toThrow(/Invalid target size/);
  });
});

describe("resampleFull (input analisis lengkap)", () => {
  const data = [
    [1, 380, 3.61, 3, "a"],
    [0, 660, 3.67, 3, "b"],
    [1, 800, 4.0, 1, "c"],
    [0, 640, 3.19, 4, "d"],
    [1, 520, 2.93, 4, "e"],
    [0, 760, 3.0, 2, "f"],
  ];
  const prep = prepareExperimentData(data, vars, vars[0], [vars[1], vars[3]]);

  test("baris yang sama dengan resample() design matrix untuk seed yang sama", () => {
    const full = resampleFull(prep.full, 200, 11);
    const design = resample(prep.X, prep.y, prep.n, prep.p, 200, 11);
    expect(full.rows).toBe(200);
    expect(Array.from(full.y)).toEqual(Array.from(design.y));
    // Kolom gre (numerik) sama persis; kolom rank berisi kode asli, design berisi dummy
    for (let i = 0; i < 200; i++) {
      expect(full.X[i * full.cols]).toBe(design.X[i * prep.p + 1]);
      const src = prep.full.X.findIndex((v, j) => j % prep.full.cols === 0 && v === full.X[i * full.cols]) / prep.full.cols;
      expect(full.X[i * full.cols + 1]).toBe(prep.full.X[src * prep.full.cols + 1]);
    }
  });

  test("model_info mengikuti N baru tanpa missing; N asli → input apa adanya", () => {
    const full = resampleFull(prep.full, 50, 3);
    expect(full.modelInfo.n_samples).toBe(50);
    expect(full.modelInfo.n_missing).toBe(0);
    expect(full.modelInfo.x_encodings).toEqual(prep.full.modelInfo.x_encodings);
    expect(full.configJson).toBe(prep.full.configJson);
    expect(resampleFull(prep.full, prep.n, 3)).toBe(prep.full);
  });
});

describe("prng", () => {
  test("mulberry32 deterministik dan di [0, 1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("shuffleInPlace mempertahankan elemen dan deterministik", () => {
    const s1 = shuffleInPlace(["A", "B", "C", "D"], mulberry32(deriveSeed(5, 1)));
    const s2 = shuffleInPlace(["A", "B", "C", "D"], mulberry32(deriveSeed(5, 1)));
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(["A", "B", "C", "D"]);
  });

  test("urutan acak cukup seimbang: tiap mode muncul di tiap posisi", () => {
    const rng = mulberry32(99);
    const counts: Record<string, number[]> = { A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0], D: [0, 0, 0, 0] };
    for (let r = 0; r < 4000; r++) {
      shuffleInPlace(["A", "B", "C", "D"], rng).forEach((m, pos) => counts[m][pos]++);
    }
    for (const m of Object.keys(counts)) for (const c of counts[m]) expect(c).toBeGreaterThan(850);
  });
});


describe("resample (v1) tidak berubah", () => {
  test("golden kecil: seed 42, n = 5, N = 12 (dicatat dari implementasi v1 sebelum v2)", () => {
    const X = Float64Array.from([1, 10, 1, 20, 1, 30, 1, 40, 1, 50]);
    const y = Float64Array.from([0, 1, 0, 1, 1]);
    const r = resample(X, y, 5, 2, 12, 42);
    expect(Array.from(r.X).filter((_, i) => i % 2 === 1)).toEqual([40, 30, 50, 40, 10, 30, 20, 40, 50, 30, 20, 50]);
    expect(Array.from(r.y)).toEqual([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1]);
    expect(r.sampling).toBe("resample");
  });
});

describe("sampling prefix (v2)", () => {
  const data = [
    [1, 380, 3.61, 3, "a"],
    [0, 660, 3.67, 3, "b"],
    [1, 800, 4.0, 1, "c"],
    [0, 640, 3.19, 4, "d"],
    [1, 520, 2.93, 4, "e"],
    [0, 760, 3.0, 2, "f"],
    [1, 560, 2.98, 1, "g"],
  ];
  const prep = prepareExperimentData(data, vars, vars[0], [vars[1], vars[3]]);

  test("N baris pertama tanpa pengembalian; core dan full memakai baris yang sama persis", () => {
    const core = sampleDataset(prep, 4, "prefix", 99);
    const full = sampleFull(prep.full, 4, "prefix", 99);
    expect(core.sampling).toBe("prefix");
    expect(core.resampled).toBe(false);
    expect(Array.from(core.X)).toEqual(Array.from(prep.X.subarray(0, 4 * prep.p)));
    expect(Array.from(core.y)).toEqual([1, 0, 1, 0]);
    expect(full.rows).toBe(4);
    expect(Array.from(full.y)).toEqual(Array.from(core.y));
    for (let i = 0; i < 4; i++) {
      // gre: kolom 0 input full = kolom 1 design matrix (setelah intercept)
      expect(full.X[i * full.cols]).toBe(core.X[i * prep.p + 1]);
      expect(full.X[i * full.cols + 1]).toBe(prep.full.X[i * prep.full.cols + 1]);
    }
    expect(full.modelInfo.n_samples).toBe(4);
    expect(full.modelInfo.n_missing).toBe(0);
  });

  test("N = n → data asli apa adanya; seed tidak berpengaruh", () => {
    expect(sampleDataset(prep, prep.n, "prefix", 1).X).toBe(prep.X);
    expect(prefixFull(prep.full, prep.n)).toBe(prep.full);
    expect(Array.from(sampleDataset(prep, 3, "prefix", 1).X)).toEqual(Array.from(sampleDataset(prep, 3, "prefix", 2).X));
  });

  test("N > n ditolak dengan pesan jelas, juga lewat checkSizes sebelum batch", () => {
    expect(() => takePrefix(prep.X, prep.y, prep.n, prep.p, prep.n + 1)).toThrow(/N must be ≤ 7.*requested N = 8/);
    expect(() => sampleFull(prep.full, 100, "prefix", 1)).toThrow(/without replacement/);
    expect(() => checkSizes([5, 7, 10, 100], prep.n, "prefix")).toThrow(/too large: 10, 100/);
    expect(() => checkSizes([5, 100], prep.n, "resample")).not.toThrow();
  });
});

describe("urutan dari orderSeed", () => {
  test("urutan N 'shuffled' deterministik untuk orderSeed yang sama, permutasi dari ukuran", () => {
    const sizes = [100000, 1000, 50000, 10000];
    const a = shuffledSizes(sizes, 1004);
    expect(shuffledSizes([...sizes].reverse(), 1004)).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual([1000, 10000, 50000, 100000]);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => shuffledSizes(sizes, 1000 + i).join(",")));
    expect(orders.size).toBeGreaterThan(5);
    expect(sizeOrderFor({ sizes, sizeOrder: "shuffled", orderSeed: 1004 })).toEqual(a);
    expect(sizeOrderFor({ sizes, sizeOrder: "ascending", orderSeed: 1004 })).toEqual([1000, 10000, 50000, 100000]);
  });

  test("urutan workload per sesi deterministik dan memakai stream terpisah", () => {
    expect(shuffledWorkloads(["full", "core"], 1007)).toEqual(shuffledWorkloads(["core", "full"], 1007));
    const seen = new Set(Array.from({ length: 16 }, (_, i) => shuffledWorkloads(["core", "full"], 1000 + i).join(",")));
    expect(seen).toEqual(new Set(["core,full", "full,core"]));
  });

  test("sel per lifecycle: persistent/per-run 4 sel (urutan v1), interleaved 6 sel", () => {
    expect(cellsFor("persistent").map((c) => c.id)).toEqual(["A", "B-warm", "C", "D-warm"]);
    expect(cellsFor("per-run").map((c) => c.id)).toEqual(["A", "B-cold", "C", "D-cold"]);
    expect(cellsFor("interleaved").map((c) => c.id)).toEqual(["A", "B-warm", "B-cold", "C", "D-warm", "D-cold"]);
  });

  test.each([
    ["core_warm_meta.json", "persistent"],
    ["core_cold_meta.json", "per-run"],
  ] as const)("urutan acak batch v1 (%s) terulang persis dengan orderSeed = seed v1", (file, lifecycle) => {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../../reproducibility/data", file), "utf8"));
    const { settings } = meta;
    for (const N of settings.sizes as number[]) {
      const rng = cellOrderRng(settings.seed, N);
      const measured: string[][] = [];
      for (let rep = 1 - settings.warmup; rep <= settings.repetitions; rep++) {
        const order = shuffleInPlace([...cellsFor(lifecycle)], rng).map((c) => CELLS[c.id].mode);
        if (rep >= 1) measured.push(order);
      }
      const v1 = meta.orders.filter((o: { N: number }) => o.N === N).map((o: { order: string[] }) => o.order);
      expect(measured).toEqual(v1);
    }
  });
});

describe("meta.json lama (v1) tetap terbaca", () => {
  test("seed → dataSeed dan orderSeed; coldWorkers → lifecycle; resample + urutan naik", () => {
    const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, "../../reproducibility/data/core_cold_meta.json"), "utf8")).settings;
    expect(normalizeBatchSettings(v1)).toEqual({
      workload: "core",
      sizes: [1470, 10000, 50000, 100000],
      warmup: 5,
      repetitions: 30,
      dataSeed: 42,
      orderSeed: 42,
      sampling: "resample",
      sizeOrder: "ascending",
      lifecycle: "per-run",
      maxIter: 20,
      tol: 0.001,
    });
    expect(normalizeBatchSettings({ ...v1, coldWorkers: false }).lifecycle).toBe("persistent");
  });

  test("pengaturan v2 dibaca apa adanya; tanpa seed atau lifecycle → error", () => {
    const v2 = {
      workload: "full",
      sizes: [1000],
      warmup: 5,
      repetitions: 30,
      dataSeed: 1,
      orderSeed: 1003,
      sampling: "prefix",
      sizeOrder: "shuffled",
      lifecycle: "interleaved",
      maxIter: 20,
      tol: 0.001,
    };
    expect(normalizeBatchSettings(v2)).toEqual(v2);
    expect(() => normalizeBatchSettings({ lifecycle: "persistent" })).toThrow(/seed/);
    expect(() => normalizeBatchSettings({ seed: 1 })).toThrow(/lifecycle/);
  });
});
