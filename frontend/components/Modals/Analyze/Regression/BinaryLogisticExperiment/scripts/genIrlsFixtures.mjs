// Generator dataset uji + golden values untuk inti IRLS eksperimen.
//
// Output dipakai bersama oleh:
//   - frontend/__tests__/irlsCore.experiment.test.js            (Jest, irls_core.js)
//   - BinaryLogistic/rust/src/bench/irls_core.rs  (cargo test, irls_core_bench)
//
// Jalankan dari folder frontend (Node >= 22, deteksi ESM otomatis):
//   node components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/genIrlsFixtures.mjs
//
// Golden values (`expected`) dihitung oleh irls_core.js. Kebenarannya dicek
// secara independen oleh test: solusi tertutup tabel 2×2 (Jest + Rust) dan
// `irls::fit` produksi (Rust). Jalankan ulang skrip ini hanya bila algoritma
// sengaja diubah di KEDUA implementasi.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "../../../../../..");
const corePath = resolve(frontend, "public/workers/Regression/BinaryExperiment/irls_core.js");
const outPath = resolve(
  frontend,
  "components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/testdata/irls_core_cases.json"
);

const { irlsCore } = await import(pathToFileURL(corePath).href);

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 2 desimal: nilai tertulis eksak di JSON sehingga JS dan Rust membaca double yang sama
const r2 = (v) => Math.round(v * 100) / 100;

function run(c) {
  try {
    const r = irlsCore(Float64Array.from(c.x), Float64Array.from(c.y), c.n, c.p, c.maxIter, c.tol);
    return {
      beta: Array.from(r.beta),
      se: Array.from(r.se),
      neg2ll: r.neg2ll,
      iterations: r.iterations,
      converged: r.converged,
      stepHalvings: r.stepHalvings,
    };
  } catch (e) {
    return { error: String(e.message) };
  }
}

const cases = [];

// 1. Sintetis kontinu: intercept + 2 kovariat. y dibangkitkan dengan link
//    rasional (tanpa exp) supaya data identik di semua runtime.
{
  const rnd = mulberry32(20261016);
  const n = 60, p = 3;
  const x = [], y = [];
  for (let i = 0; i < n; i++) {
    const x1 = r2(rnd() * 4 - 2);
    const x2 = r2(rnd() * 3 - 1);
    const lin = -0.4 + 1.1 * x1 - 0.8 * x2;
    const q = 0.5 + 0.5 * (lin / (1 + Math.abs(lin)));
    x.push(1, x1, x2);
    y.push(rnd() < q ? 1 : 0);
  }
  cases.push({ name: "synthetic_n60_p3", n, p, x, y, maxIter: 20, tol: 0.001 });
}

// 2. Tabel 2×2 (kovariat biner): MLE punya solusi tertutup
//    b0 = ln(n01/n00), b1 = ln(n11/n10) - b0,
//    Var(b0) = 1/n00 + 1/n01, Var(b1) = 1/n00 + 1/n01 + 1/n10 + 1/n11.
{
  const cells = [
    [0, 0, 12],
    [0, 1, 8],
    [1, 0, 5],
    [1, 1, 15],
  ];
  const x = [], y = [];
  for (const [xv, yv, cnt] of cells) {
    for (let k = 0; k < cnt; k++) {
      x.push(1, xv);
      y.push(yv);
    }
  }
  cases.push({
    name: "two_by_two",
    n: y.length, p: 2, x, y, maxIter: 20, tol: 0.001,
    closedForm: { n00: 12, n01: 8, n10: 5, n11: 15 },
  });
}

// 3. Overshoot Newton yang nyata (seed 469778 dari pencarian acak): langkah
//    penuh di iterasi 8 menurunkan LL 0.55%, langkah 0.5 menaikkannya 0.28%.
//    Semua perbandingan LL jauh di atas noise pembulatan, jadi keputusan
//    step-halving stabil lintas runtime (fdlibm di V8 vs libm di Rust).
{
  const rnd = mulberry32(469778);
  const n = 12 + Math.floor(rnd() * 40), p = 2 + Math.floor(rnd() * 3);
  const base = rnd() * 6 - 3, rho = rnd() * 1.8 - 0.9, sk = rnd() < 0.5;
  const coef = [base];
  for (let j = 1; j < p; j++) coef.push(rnd() * 8 - 4);
  const x = [], y = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    let prev = 0, lin = coef[0];
    for (let j = 1; j < p; j++) {
      let v = rnd() * 2 - 1;
      if (sk) v = v * v * v * 3;
      v = r2(rho * prev + v);
      prev = v;
      row.push(v);
      lin += coef[j] * v;
    }
    x.push(...row);
    const q = 0.5 + 0.5 * (lin / (1 + Math.abs(lin)));
    y.push(rnd() < q ? 1 : 0);
  }
  cases.push({ name: "step_halving", n, p, x, y, maxIter: 20, tol: 0.001 });
}

// 4. Batas iterasi: maxIter = 2 -> belum konvergen
cases.push({ ...cases[0], name: "max_iter_2", maxIter: 2 });

// 5. Kolom nol: IRLS tetap jalan (ridge), tetapi Cholesky kovarians gagal
{
  const rnd = mulberry32(7);
  const n = 20, p = 3;
  const x = [], y = [];
  for (let i = 0; i < n; i++) {
    x.push(1, r2(rnd() * 2 - 1), 0);
    y.push(i % 3 === 0 ? 1 : 0);
  }
  cases.push({ name: "zero_column_cholesky_fail", n, p, x, y, maxIter: 20, tol: 0.001 });
}

for (const c of cases) c.expected = run(c);

// JSON ringkas: array tetap satu baris per field, struktur luar terindentasi
const body = cases
  .map((c) => {
    const fields = Object.entries(c).map(([k, v]) => `   ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `  {\n${fields.join(",\n")}\n  }`;
  })
  .join(",\n");
const description =
  "Dataset uji bersama untuk irls_core.js (Jest) dan rust/src/bench/irls_core.rs (cargo test). " +
  "x row-major n*p (kolom 0 = intercept). expected = golden values dari irls_core.js; kedua " +
  "implementasi harus cocok hingga 1e-10. Dibuat oleh BinaryLogisticExperiment/scripts/genIrlsFixtures.mjs.";
writeFileSync(outPath, `{\n "description": ${JSON.stringify(description)},\n "cases": [\n${body}\n ]\n}\n`);

for (const c of cases) console.log(c.name, JSON.stringify(c.expected));
console.log("ditulis:", outPath);
