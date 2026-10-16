/**
 * Unit test fungsi murni runner/metrik eksperimen Binary Logistic:
 * kuantil & ringkasan, statistik frame, akurasi antar mode, CSV, dan
 * pemetaan Constant ↔ intercept pada pembanding produksi.
 */
import type { BatchMeta, ExperimentMode, RunRecord } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/types/experiment";
import { computeFrameStats, quantile, summarize } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/metrics";
import {
  accuracyPassed,
  computeAccuracy,
  computeSummaries,
  maxAbsDiff,
  maxScaledDiff,
  worstAccuracyByN,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/analysis";
import { buildRunsCsv, csvEscape } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/exportCsv";
import { compareWithProduction } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/productionCompare";
import { totalBatchRuns, validateSettings } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/runner";

jest.mock("@/stores/useDataStore", () => ({ useDataStore: { getState: () => ({ data: [] }) } }));
jest.mock("@/stores/useVariableStore", () => ({ useVariableStore: { getState: () => ({ variables: [] }) } }));

function rec(mode: ExperimentMode, N: number, e2eMs: number, beta: number[], extra: Partial<RunRecord> = {}): RunRecord {
  return {
    batchId: "b",
    workload: "core",
    runIndex: 1,
    phase: "measure",
    N,
    p: beta.length,
    rep: 1,
    orderInRep: 1,
    mode,
    workerStart: null,
    computeMs: e2eMs,
    e2eMs,
    overheadMs: 0,
    spawnMs: null,
    initMs: null,
    engineInitMs: null,
    formatMs: null,
    totalMs: null,
    tablesHash: null,
    maxFrameGapMs: 16.7,
    droppedFrames: 0,
    frameCount: 3,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    heapUsedMB: null,
    wasmMemoryMB: null,
    pageHidden: false,
    result: { beta, se: beta.map((b) => Math.abs(b) / 10), neg2ll: 100, iterations: 4, converged: true, stepHalvings: 0, wasmCoreMs: null },
    error: null,
    timestamp: "2026-10-16T00:00:00.000Z",
    ...extra,
  };
}

describe("quantile / summarize (tipe 7, sama dengan R quantile default)", () => {
  test("nilai kuartil", () => {
    const v = [1, 2, 3, 4];
    expect(quantile(v, 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile(v, 0.5)).toBeCloseTo(2.5, 12);
    expect(quantile(v, 0.75)).toBeCloseTo(3.25, 12);
  });

  test("summarize mengurutkan, membuang non-finite, dan menghitung IQR", () => {
    const s = summarize([10, 2, NaN, 7, 4, Infinity, 1])!;
    expect(s.count).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(10);
    expect(s.median).toBe(4);
    expect(s.q1).toBe(2);
    expect(s.q3).toBe(7);
    expect(s.iqr).toBe(5);
    expect(summarize([NaN])).toBeNull();
  });
});

describe("computeFrameStats", () => {
  test("gap maksimum dan frame drop (> 2 × 16,7 ms)", () => {
    const s = computeFrameStats([0, 16.7, 33.4, 150, 166.7, 210]);
    expect(s.maxFrameGapMs).toBeCloseTo(116.6, 9);
    expect(s.droppedFrames).toBe(2); // 116,6 dan 43,3
    expect(s.frameCount).toBe(6);
  });

  test("kurang dari dua frame → gap NaN", () => {
    expect(computeFrameStats([5]).maxFrameGapMs).toBeNaN();
  });
});

describe("computeSummaries & computeAccuracy", () => {
  const records = [
    rec("A", 100, 10, [0.5, 1.2]),
    rec("A", 100, 30, [0.5, 1.2]),
    rec("A", 100, 20, [0.5, 1.2]),
    rec("B", 100, 12, [0.5, 1.2 + 1e-12]),
    rec("C", 100, 5, [0.5 + 3e-9, 1.2]),
    rec("D", 100, 6, [0.5, 1.2]),
    rec("D", 100, 7, [0.5, 1.2]),
    rec("D", 500, 60, [0.4, 1.0]),
    rec("A", 500, 0, [0, 0], { result: null, error: "boom" }),
  ];

  test("median/IQR per (N, mode), run error dihitung terpisah", () => {
    const s = computeSummaries(records);
    const a100 = s.find((x) => x.N === 100 && x.mode === "A")!;
    expect(a100.runs).toBe(3);
    expect(a100.e2eMs!.median).toBe(20);
    expect(a100.e2eMs!.iqr).toBe(10);
    const a500 = s.find((x) => x.N === 500 && x.mode === "A")!;
    expect(a500.errors).toBe(1);
    expect(a500.e2eMs).toBeNull();
    expect(s.map((x) => `${x.N}${x.mode}`)).toEqual(["100A", "100B", "100C", "100D", "500A", "500D"]);
  });

  test("selisih maksimum terhadap mode D", () => {
    const acc = computeAccuracy(records);
    const at = (m: ExperimentMode) => acc.find((r) => r.N === 100 && r.mode === m)!;
    expect(at("A").maxAbsDiffBeta).toBe(0);
    expect(at("B").maxAbsDiffBeta).toBeCloseTo(1e-12, 15); // 1.2 + 1e-12 tidak eksak di double
    expect(at("C").maxAbsDiffBeta).toBeCloseTo(3e-9, 15);
    expect(at("D").maxAbsDiffBeta).toBe(0);
    // N=500: hanya D yang sukses
    expect(acc.filter((r) => r.N === 500).map((r) => r.mode)).toEqual(["D"]);
  });

  test("maxAbsDiff: panjang beda → Infinity, NaN terbawa", () => {
    expect(maxAbsDiff([1], [1, 2])).toBe(Infinity);
    expect(maxAbsDiff([1, NaN], [1, 2])).toBeNaN();
  });

  test("workload core: formatMs/totalMs kosong, tanpa uji tabel", () => {
    expect(computeSummaries(records)[0].totalMs).toBeNull();
    expect(computeAccuracy(records)[0].tablesIdentical).toBeNull();
  });
});

describe("workload full (analisis lengkap + tabel SPSS)", () => {
  const full = (mode: ExperimentMode, beta: number[], hash: string, totalMs: number, extra: Partial<RunRecord> = {}) =>
    rec(mode, 300, totalMs - 2, beta, { workload: "full", formatMs: 2, totalMs, tablesHash: hash, engineInitMs: 0, ...extra });
  const records = [
    full("D", [0.5, 1.2e6], "h1", 20),
    full("D", [0.5, 1.2e6], "h1", 22),
    full("A", [0.5, 1.2e6 + 1e-3], "h1", 30), // selisih absolut 1e-3, berskala ≈ 8e-10
    full("B", [0.5, 1.2e6], "h2", 25), // tabel SPSS berbeda
    full("C", [0.5, 1.2e6], "h1", 10, { error: "boom", result: null, tablesHash: null }),
  ];

  test("ringkasan formatMs dan totalMs per mode", () => {
    const s = computeSummaries(records);
    const d = s.find((x) => x.mode === "D")!;
    expect(d.totalMs!.median).toBe(21);
    expect(d.formatMs!.median).toBe(2);
    expect(s.find((x) => x.mode === "C")!.totalMs).toBeNull(); // hanya run gagal
  });

  test("tabel identik dihitung terhadap run pertama mode D; lulus memakai selisih berskala", () => {
    const acc = computeAccuracy(records);
    const at = (m: ExperimentMode) => acc.find((r) => r.mode === m)!;
    expect(at("D").tablesIdentical).toEqual({ identical: 2, total: 2 });
    expect(at("A").tablesIdentical).toEqual({ identical: 1, total: 1 });
    expect(at("B").tablesIdentical).toEqual({ identical: 0, total: 1 });
    // rec() memakai S.E. = |B| / 10, jadi S.E. A ikut bergeser 1e-4
    expect(at("A").maxAbsDiffSe).toBeCloseTo(1e-4, 9);
    expect(at("A").maxAbsDiffBeta).toBeGreaterThan(1e-8);
    expect(at("A").maxScaledDiff).toBeLessThan(1e-8);
    expect(accuracyPassed(at("A"))).toBe(true);
    expect(accuracyPassed(at("B"))).toBe(false);
    expect(acc.some((r) => r.mode === "C")).toBe(false);
    expect(worstAccuracyByN(acc)).toEqual([{ N: 300, beta: at("A").maxAbsDiffBeta, se: at("A").maxAbsDiffSe, passed: false }]);
  });

  test("maxScaledDiff: relatif untuk nilai besar, absolut untuk nilai kecil", () => {
    expect(maxScaledDiff([1e6], [1e6 + 1])).toBeCloseTo(1 / (1e6 + 1), 15);
    expect(maxScaledDiff([0.001], [0.002])).toBeCloseTo(0.001, 12);
    expect(maxScaledDiff([1], [1, 2])).toBe(Infinity);
  });
});

describe("CSV", () => {
  test("escaping", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(1.5)).toBe("1.5");
    expect(csvEscape(NaN)).toBe("NaN");
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(true)).toBe("true");
  });

  test("satu baris per run, kolom koefisien bernama, metadata di tiap baris", () => {
    const meta = {
      batchId: "batch-1",
      startedAt: "2026-10-16T00:00:00.000Z",
      settings: { sizes: [100], warmup: 1, repetitions: 2, seed: 7, coldWorkers: false, maxIter: 20, tol: 0.001 },
      environment: {
        userAgent: "UA, test",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        crossOriginIsolated: true,
        buildMode: "production",
        gitCommit: "abc123",
        refreshIntervalMs: 16.7,
        timerResolutionMs: 0.005,
        longTaskSupported: true,
        memoryApiSupported: true,
        capturedAt: "x",
      },
      mainThreadInit: { jsImportMs: 1, wasmImportMs: 2, wasmInitMs: 3 },
      warmWorkerInit: { B: { spawnMs: 4, initMs: 0 }, D: { spawnMs: 5, initMs: 6 } },
      dataset: { dependent: "admit", covariates: ["gre", "gpa"], nOriginal: 100, nTotalRows: 100, nMissing: 0, p: 2 },
    } as unknown as BatchMeta;
    const csv = buildRunsCsv([rec("A", 100, 10, [0.5, 1.2]), rec("C", 100, 5, [0.5, 1.2], { error: "x" })], meta, ["Constant", "gre"]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    const header = lines[0].split(",");
    expect(header).toEqual(expect.arrayContaining(["mode", "computeMs", "e2eMs", "B_Constant", "B_gre", "SE_gre", "userAgent", "gitCommit", "buildMode"]));
    const row = lines[1];
    expect(row).toContain('"UA, test"');
    expect(row).toContain("abc123");
    expect(lines[2].split(",")[header.indexOf("error")]).toBe("x");
    expect(lines[1].split(",")[header.indexOf("workload")]).toBe("core");
    expect(lines[1].split(",")[header.indexOf("totalMs")]).toBe("");
  });

  test("workload full: formatMs, totalMs, dan kesamaan tabel SPSS terhadap run D pertama per N", () => {
    const meta = {
      batchId: "batch-full-1",
      startedAt: "x",
      settings: { workload: "full", sizes: [100], warmup: 0, repetitions: 1, seed: 1, coldWorkers: false, maxIter: 20, tol: 0.001 },
      environment: { userAgent: "UA" },
      mainThreadInit: { jsImportMs: null, enterImportMs: 4, wasmImportMs: 2, wasmInitMs: 3 },
      warmWorkerInit: { B: { spawnMs: 4, initMs: 0, engineInitMs: 1.5 } },
      dataset: { dependent: "y", covariates: ["x"], nOriginal: 100, nTotalRows: 100, nMissing: 0, p: 2, cols: 1 },
    } as unknown as BatchMeta;
    const full = (mode: ExperimentMode, hash: string) =>
      rec(mode, 100, 10, [0.5, 1.2], { workload: "full", formatMs: 1.5, totalMs: 12, tablesHash: hash });
    const csv = buildRunsCsv([full("A", "h2"), full("D", "h1"), full("B", "h1")], meta, ["Constant", "x"]);
    const lines = csv.trim().split("\r\n");
    const header = lines[0].split(",");
    const col = (i: number, name: string) => lines[i].split(",")[header.indexOf(name)];
    expect(col(1, "workload")).toBe("full");
    expect(col(1, "formatMs")).toBe("1.5");
    expect(col(1, "totalMs")).toBe("12");
    expect([col(1, "tablesIdenticalToD"), col(2, "tablesIdenticalToD"), col(3, "tablesIdenticalToD")]).toEqual(["false", "true", "true"]);
    expect(col(1, "mainEnterImportMs")).toBe("4");
    expect(col(1, "warmEngineInitMsB")).toBe("1.5");
  });
});

describe("compareWithProduction", () => {
  const experiment = { beta: [-0.3, 0.7, -0.6], se: [0.3, 0.28, 0.35], neg2ll: 70, iterations: 4, converged: true, stepHalvings: 0, wasmCoreMs: null };

  test("Constant dipetakan ke intercept, kovariat lewat nama (urutan produksi boleh beda)", () => {
    const prod = {
      rows: [
        { label: "Constant", b: -0.30000001, se: 0.3 },
        { label: "x2", b: -0.6, se: 0.35 },
        { label: "x1", b: 0.7, se: 0.28000002 },
      ],
      neg2ll: 70,
      iterations: 4,
      converged: true,
    };
    const c = compareWithProduction(prod, experiment, ["Constant", "x1", "x2"], "D", 60);
    expect(c.rows.map((r) => r.label)).toEqual(["Constant", "x1", "x2"]);
    expect(c.rows[2].bProduction).toBe(-0.6);
    expect(c.maxAbsDiffB).toBeCloseTo(1e-8, 12);
    expect(c.maxAbsDiffSe).toBeCloseTo(2e-8, 12);
    expect(c.passed).toBe(true);
  });

  test("baris grup kategorik (tanpa B) dilewati; dummy dicocokkan lewat nama", () => {
    const exp = { ...experiment, beta: [-0.3, 0.7, 0.2, -0.5], se: [0.3, 0.28, 0.4, 0.41] };
    const prod = {
      rows: [
        { label: "Constant", b: -0.3, se: 0.3 },
        { label: "x1", b: 0.7, se: 0.28 },
        { label: "grp", b: 0, se: 0 }, // baris omnibus grup (df > 1)
        { label: "grp(1)", b: 0.2, se: 0.4 },
        { label: "grp(2)", b: -0.5, se: 0.41 },
      ],
      neg2ll: 70,
      iterations: 4,
      converged: true,
    };
    const c = compareWithProduction(prod, exp, ["Constant", "x1", "grp(1)", "grp(2)"], "D", 60);
    expect(c.maxAbsDiffB).toBe(0);
    expect(c.passed).toBe(true);
    expect(() => compareWithProduction(prod, exp, ["Constant", "x1", "grp(1)", "zzz"], "D", 60)).toThrow(/no row for "zzz"/);
  });

  test("selisih di atas toleransi → gagal", () => {
    const prod = { rows: [{ label: "Constant", b: -0.2, se: 0.3 }, { label: "x1", b: 0.7, se: 0.28 }, { label: "x2", b: -0.6, se: 0.35 }], neg2ll: null, iterations: null, converged: null };
    expect(compareWithProduction(prod, experiment, ["Constant", "x1", "x2"], "A", 60).passed).toBe(false);
  });
});

describe("validasi pengaturan batch", () => {
  const base = { workload: "core" as const, sizes: [100, 1000], warmup: 5, repetitions: 30, seed: 1, coldWorkers: false, maxIter: 20, tol: 0.001 };
  test("jumlah run total = |N| × (warm-up + ulangan) × 4", () => {
    expect(totalBatchRuns(base)).toBe(2 * 35 * 4);
  });
  test("nilai tidak valid ditolak", () => {
    expect(() => validateSettings(base)).not.toThrow();
    expect(() => validateSettings({ ...base, sizes: [] })).toThrow(/at least one/);
    expect(() => validateSettings({ ...base, repetitions: 0 })).toThrow(/Repetitions/);
    expect(() => validateSettings({ ...base, seed: 1.5 })).toThrow(/Seed/);
  });
});
