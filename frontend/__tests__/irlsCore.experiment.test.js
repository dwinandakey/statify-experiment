/**
 * Unit test inti IRLS eksperimen 2×2 (public/workers/Regression/BinaryExperiment/irls_core.js).
 *
 * Dataset dan golden values dibagi dengan test Rust (rust/src/bench/irls_core.rs)
 * lewat satu file fixture, sehingga kedua implementasi dicek terhadap angka
 * yang sama hingga 1e-10.
 */
import { irlsCore } from "../public/workers/Regression/BinaryExperiment/irls_core.js";

const fixtures = require("../components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/testdata/irls_core_cases.json");

const GOLDEN_TOL = 1e-10;
const byName = Object.fromEntries(fixtures.cases.map((c) => [c.name, c]));

function runCase(c) {
  return irlsCore(Float64Array.from(c.x), Float64Array.from(c.y), c.n, c.p, c.maxIter, c.tol);
}

function maxAbsDiff(a, b) {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("irlsCore - golden values bersama dengan Rust", () => {
  const okCases = fixtures.cases.filter((c) => !c.expected.error);

  test.each(okCases.map((c) => [c.name, c]))("%s", (_name, c) => {
    const r = runCase(c);
    const e = c.expected;
    expect(maxAbsDiff(r.beta, e.beta)).toBeLessThan(GOLDEN_TOL);
    expect(maxAbsDiff(r.se, e.se)).toBeLessThan(GOLDEN_TOL);
    expect(Math.abs(r.neg2ll - e.neg2ll)).toBeLessThan(GOLDEN_TOL);
    expect(r.iterations).toBe(e.iterations);
    expect(r.converged).toBe(e.converged);
    expect(r.stepHalvings).toBe(e.stepHalvings);
  });
});

describe("irlsCore - kebenaran numerik", () => {
  test("tabel 2×2 cocok dengan solusi tertutup MLE", () => {
    const c = byName.two_by_two;
    const { n00, n01, n10, n11 } = c.closedForm;
    const b0 = Math.log(n01 / n00);
    const b1 = Math.log(n11 / n10) - b0;
    const se0 = Math.sqrt(1 / n00 + 1 / n01);
    const se1 = Math.sqrt(1 / n00 + 1 / n01 + 1 / n10 + 1 / n11);
    const p0 = n01 / (n00 + n01);
    const p1 = n11 / (n10 + n11);
    const ll = n01 * Math.log(p0) + n00 * Math.log(1 - p0) + n11 * Math.log(p1) + n10 * Math.log(1 - p1);

    const r = runCase(c);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.beta[0] - b0)).toBeLessThan(1e-6);
    expect(Math.abs(r.beta[1] - b1)).toBeLessThan(1e-6);
    expect(Math.abs(r.se[0] - se0)).toBeLessThan(1e-6);
    expect(Math.abs(r.se[1] - se1)).toBeLessThan(1e-6);
    expect(Math.abs(r.neg2ll - -2 * ll)).toBeLessThan(1e-8);
  });

  test("gradien skor ≈ 0 di solusi (data sintetis kontinu)", () => {
    const c = byName.synthetic_n60_p3;
    const r = runCase(c);
    const g = new Array(c.p).fill(0);
    for (let i = 0; i < c.n; i++) {
      let eta = 0;
      for (let j = 0; j < c.p; j++) eta += c.x[i * c.p + j] * r.beta[j];
      const mu = 1 / (1 + Math.exp(-eta));
      for (let j = 0; j < c.p; j++) g[j] += c.x[i * c.p + j] * (c.y[i] - mu);
    }
    for (const gj of g) expect(Math.abs(gj)).toBeLessThan(1e-6);
  });

  test("kasus step-halving benar-benar melakukan halving dan tetap konvergen", () => {
    const r = runCase(byName.step_halving);
    expect(r.stepHalvings).toBeGreaterThan(0);
    expect(r.converged).toBe(true);
  });

  test("maxIter tercapai -> converged false dan iterations = maxIter", () => {
    const r = runCase(byName.max_iter_2);
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(2);
  });
});

describe("irlsCore - kegagalan Cholesky", () => {
  test("kolom nol: IRLS lolos berkat ridge, Cholesky kovarians (tanpa ridge) gagal", () => {
    const c = byName.zero_column_cholesky_fail;
    expect(() => runCase(c)).toThrow(/Cholesky gagal saat menghitung kovarians/);
    expect(c.expected.error).toMatch(/Cholesky gagal saat menghitung kovarians/);
  });

  test("NaN di X membuat Hessian tidak positive definite di iterasi pertama", () => {
    const c = byName.synthetic_n60_p3;
    const X = Float64Array.from(c.x);
    X[4] = NaN;
    expect(() => irlsCore(X, Float64Array.from(c.y), c.n, c.p)).toThrow(
      /Cholesky gagal pada iterasi 1/
    );
  });
});

describe("irlsCore - kontrak fungsi", () => {
  test("mengembalikan Float64Array panjang p dan tidak mengubah input", () => {
    const c = byName.synthetic_n60_p3;
    const X = Float64Array.from(c.x);
    const y = Float64Array.from(c.y);
    const r = irlsCore(X, y, c.n, c.p);
    expect(r.beta).toBeInstanceOf(Float64Array);
    expect(r.se).toBeInstanceOf(Float64Array);
    expect(r.beta).toHaveLength(c.p);
    expect(r.se).toHaveLength(c.p);
    expect(Array.from(X)).toEqual(c.x);
    expect(Array.from(y)).toEqual(c.y);
  });

  test("default maxIter = 20 dan tol = 0.001", () => {
    const c = byName.synthetic_n60_p3;
    const r = irlsCore(Float64Array.from(c.x), Float64Array.from(c.y), c.n, c.p);
    expect(Array.from(r.beta)).toEqual(c.expected.beta);
  });

  test("validasi dimensi dan tipe input", () => {
    const X = new Float64Array(6);
    const y = new Float64Array(3);
    expect(() => irlsCore(X, y, 3, 3)).toThrow(/panjang X/);
    expect(() => irlsCore(X, new Float64Array(2), 3, 2)).toThrow(/panjang y/);
    expect(() => irlsCore(Array.from(X), y, 3, 2)).toThrow(TypeError);
    expect(() => irlsCore(X, y, 3, 2, 0)).toThrow(/maxIter/);
    expect(() => irlsCore(X, y, 3, 2, 20, 0)).toThrow(/tol/);
  });
});
