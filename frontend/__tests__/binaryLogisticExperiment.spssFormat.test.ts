/**
 * Unit test pipeline tabel SPSS analisis lengkap (tombol OK dan batch
 * workload "full"): hasil port JS logistic_enter.js → payload seperti worker
 * produksi → formatter produksi, ekstraksi B/S.E., dan hash tabel.
 */
import type { Variable } from "@/types/Variable";
import { prepareExperimentData, resampleFull } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prepareData";
import {
  coefficientsFromResult,
  formatSpssTables,
  hashText,
  spssTablesHash,
  stepHalvingsFromResult,
  toProductionPayload,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/spssFormat";
import { mulberry32 } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prng";
import { irlsCore } from "../public/workers/Regression/BinaryExperiment/irls_core.js";
import { calculateBinaryLogistic } from "../public/workers/Regression/BinaryExperiment/logistic_enter.js";

jest.mock("@/stores/useDataStore", () => ({ useDataStore: { getState: () => ({ data: [] }) } }));
jest.mock("@/stores/useVariableStore", () => ({ useVariableStore: { getState: () => ({ variables: [] }) } }));

function mkVar(id: number, columnIndex: number, name: string, measure: Variable["measure"] = "scale", type: Variable["type"] = "NUMERIC"): Variable {
  return { id, columnIndex, name, type, width: 8, decimals: 2, values: [], missing: null, columns: 8, align: "right", measure, role: "input" };
}

const vars = [mkVar(1, 0, "y", "nominal"), mkVar(2, 1, "x1"), mkVar(3, 2, "x2"), mkVar(4, 3, "grp", "nominal", "STRING")];

/** Data sintetis deterministik: y ~ x1 + x2 + grp (low/mid/high). */
function makeData(n: number, seed: number) {
  const rng = mulberry32(seed);
  const groups = ["low", "mid", "high"];
  const rows: (string | number)[][] = [];
  for (let i = 0; i < n; i++) {
    const x1 = rng() * 4 - 2;
    const x2 = rng() * 2;
    const g = groups[Math.floor(rng() * 3)];
    const eta = -0.4 + 0.8 * x1 - 0.6 * x2 + (g === "high" ? 0.5 : g === "low" ? -0.3 : 0);
    rows.push([rng() < 1 / (1 + Math.exp(-eta)) ? 1 : 0, x1, x2, g]);
  }
  return rows;
}

function run(data: (string | number)[][]) {
  const prep = prepareExperimentData(data, vars, vars[0], [vars[1], vars[2], vars[3]]);
  const f = prep.full;
  const raw = calculateBinaryLogistic(f.X, f.rows, f.cols, f.y, f.configJson, f.featureNamesJson);
  return { prep, raw };
}

describe("formatSpssTables (formatter produksi atas hasil analisis lengkap)", () => {
  const { prep, raw } = run(makeData(300, 5));

  test("menghasilkan tabel SPSS utama Enter", () => {
    const out = formatSpssTables(raw, prep.full.modelInfo, prep.dependent, prep.covariates);
    const titles = out.sections.map((s) => s.title.replace(/<[^>]*>?/gm, " "));
    for (const t of ["Case Processing Summary", "Dependent Variable Encoding", "Categorical Variables Codings", "Classification Table", "Variables in the Equation", "Model Summary"]) {
      expect(titles.some((x) => x.includes(t))).toBe(true);
    }
  });

  test("hash tabel deterministik dan peka terhadap isi", () => {
    const a = spssTablesHash(formatSpssTables(raw, prep.full.modelInfo, prep.dependent, prep.covariates));
    const again = run(makeData(300, 5));
    const b = spssTablesHash(formatSpssTables(again.raw, again.prep.full.modelInfo, prep.dependent, prep.covariates));
    const other = run(makeData(300, 6));
    const c = spssTablesHash(formatSpssTables(other.raw, other.prep.full.modelInfo, prep.dependent, prep.covariates));
    expect(a).toMatch(/^[0-9a-f]{14}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  test("data hasil resampleFull bisa dianalisis dan diformat (N baru di Case Processing Summary)", () => {
    const big = resampleFull(prep.full, 2000, 9);
    const rawBig = calculateBinaryLogistic(big.X, big.rows, big.cols, big.y, big.configJson, big.featureNamesJson);
    const out = formatSpssTables(rawBig, big.modelInfo, prep.dependent, prep.covariates);
    expect(JSON.stringify(out.sections)).toContain("2000");
  });
});

describe("coefficientsFromResult", () => {
  const { prep, raw } = run(makeData(300, 5));

  test("B dan S.E. urut featureNames (Constant, kovariat, dummy), baris grup dilewati", () => {
    const c = coefficientsFromResult(raw, prep.featureNames);
    expect(prep.featureNames).toEqual(["Constant", "x1", "x2", "grp(1)", "grp(2)"]);
    expect(c.beta).toHaveLength(5);
    expect(c.beta.every(Number.isFinite)).toBe(true);
    expect(c.se.every((v) => v > 0)).toBe(true);
    expect(c.converged).toBe(true);
    expect(c.stepHalvings).toBe(stepHalvingsFromResult(raw));
    expect(c.neg2ll).toBeGreaterThan(0);
  });

  test("sama dengan inti IRLS pada design matrix yang sama", () => {
    const c = coefficientsFromResult(raw, prep.featureNames);
    const core = irlsCore(prep.X, prep.y, prep.n, prep.p);
    for (let j = 0; j < prep.p; j++) {
      expect(Math.abs(c.beta[j] - core.beta[j])).toBeLessThan(1e-8);
      expect(Math.abs(c.se[j] - core.se[j])).toBeLessThan(1e-8);
    }
    expect(Math.abs(c.neg2ll - core.neg2ll)).toBeLessThan(1e-8);
  });

  test("label yang hilang dan nilai null (non-finite dari serde) → NaN", () => {
    const fake = {
      variables_in_equation: [
        { label: "Constant", b: 0.1, error: null },
        { label: "x1", b: 0.5, error: 0.2 },
      ],
      model_summary: { log_likelihood: -50, iterations: 4, converged: true },
    };
    const c = coefficientsFromResult(fake, ["Constant", "x1", "x2"]);
    expect(c.beta).toEqual([0.1, 0.5, NaN]);
    expect(c.se).toEqual([NaN, 0.2, NaN]);
    expect(c.neg2ll).toBe(100);
    expect(c.iterations).toBe(4);
  });
});

describe("stepHalvingsFromResult", () => {
  test("dari fitting_warnings.step_halving_count; tanpa fitting_warnings berarti 0", () => {
    expect(stepHalvingsFromResult({ fitting_warnings: { step_halving_count: 3, messages: [] } })).toBe(3);
    expect(stepHalvingsFromResult({ model_summary: {} })).toBe(0);
    expect(stepHalvingsFromResult({ fitting_warnings: {} })).toBeNaN();
  });

  test("sama dengan jumlah step-halving inti IRLS pada data yang sama", () => {
    const { prep, raw } = run(makeData(300, 5));
    const core = irlsCore(prep.X, prep.y, prep.n, prep.p);
    expect(stepHalvingsFromResult(raw)).toBe(core.stepHalvings);
  });
});

describe("toProductionPayload", () => {
  const { prep, raw } = run(makeData(120, 2));

  test("menambahkan model_info dan method_used seperti worker produksi", () => {
    const payload = toProductionPayload(raw, prep.full.modelInfo);
    expect(payload.method_used).toBe("Enter");
    expect(payload.model_info).toMatchObject({ ...prep.full.modelInfo, step_number: expect.any(Number) });
  });

  test("hasil tanpa classification_table ditolak seperti handleAnalyze produksi", () => {
    expect(() => toProductionPayload({}, prep.full.modelInfo)).toThrow(/Calculation failed/);
    expect(() => toProductionPayload(null, prep.full.modelInfo)).toThrow(/Calculation failed/);
  });
});

describe("hashText", () => {
  test("deterministik, 14 digit hex, berbeda untuk teks berbeda", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).toMatch(/^[0-9a-f]{14}$/);
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).not.toBe(hashText(" "));
  });
});
