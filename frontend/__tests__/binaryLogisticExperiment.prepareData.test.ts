/**
 * Unit test persiapan data eksperimen Binary Logistic (Experiment):
 * listwise deletion, encoding Y (salinan processDependentVariable produksi),
 * dummy coding kategorik Indicator (Last) seperti pipeline produksi, dan
 * resampling ber-seed.
 */
import type { Variable } from "@/types/Variable";
import {
  encodeCategorical,
  encodeDependent,
  prepareExperimentData,
  resample,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prepareData";
import {
  deriveSeed,
  mulberry32,
  shuffleInPlace,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prng";

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
