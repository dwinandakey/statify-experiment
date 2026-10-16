// Cek paritas port JavaScript (logistic_enter.js, mode A/B) dengan
// calculate_binary_logistic Rust (paket wasm eksperimen, mode C/D) untuk
// metode Enter dengan opsi default. Seluruh objek hasil dibandingkan:
// struktur & string harus sama persis, angka cocok hingga toleransi relatif.
// Juga memastikan calculate_binary_logistic_timed (mode C/D workload full)
// mengembalikan string JSON yang identik dengan calculate_binary_logistic.
//
// Jalankan dari folder frontend (Node >= 22):
//   node components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/checkEnterParity.mjs
// Exit code 0 = semua dataset lulus. Dipanggil juga oleh
// __tests__/logisticEnterParity.experiment.test.js.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOL = 1e-8;
const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "../../../../../..");
const expDir = resolve(frontend, "public/workers/Regression/BinaryExperiment");

const { calculateBinaryLogistic } = await import(pathToFileURL(resolve(expDir, "logistic_enter.js")).href);
const wasm = await import(pathToFileURL(resolve(expDir, "pkg/statify_logistic.js")).href);
wasm.initSync({ module: readFileSync(resolve(expDir, "pkg/statify_logistic_bg.wasm")) });

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const logistic = (eta, u) => (u < 1 / (1 + Math.exp(-eta)) ? 1 : 0);

/** rustConfig seperti binaryLogistic.worker.js produksi (Enter, opsi default). */
function configJson(categoricalCols) {
  return JSON.stringify({
    dependent_index: 0,
    independent_indices: [],
    categoricalVariables: categoricalCols.map((columnIndex) => ({ columnIndex, method: "Indicator", reference: "Last" })),
    max_iterations: 20,
    convergence_threshold: 0.001,
    include_constant: true,
    confidence_level: 95,
    cutoff: 0.5,
    method: "Enter",
    p_entry: 0.05,
    p_removal: 0.1,
    hosmer_lemeshow: false,
    classification_plots: false,
    casewise_listing: false,
    casewise_type: "outliers",
    casewise_outliers: 2.0,
    iteration_history: false,
    correlations: false,
    display_at_last_step: false,
    save_predicted_probabilities: false,
    save_predicted_group: false,
    save_residuals_unstandardized: false,
    save_residuals_logit: false,
    save_residuals_studentized: false,
    save_residuals_standardized: false,
    save_residuals_deviance: false,
    save_influence_cooks: false,
    save_influence_leverage: false,
    save_influence_dfbeta: false,
    assumptions: {},
  });
}

function dataset(name, n, makeRow, featureNames, categoricalCols = []) {
  const cols = featureNames.length;
  const x = new Float64Array(n * cols);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { values, label } = makeRow(i);
    for (let j = 0; j < cols; j++) x[i * cols + j] = values[j];
    y[i] = label;
  }
  return { name, n, cols, x, y, featureNames, config: configJson(categoricalCols) };
}

const datasets = [];
{
  const r = mulberry32(1);
  datasets.push(
    dataset("numeric_3", 300, () => {
      const x1 = r3(r() * 4 - 2), x2 = r3((r() + r() + r() - 1.5) * 2), x3 = r3(r() * 10);
      return { values: [x1, x2, x3], label: logistic(-0.5 + 0.9 * x1 - 0.6 * x2 + 0.15 * x3, r()) };
    }, ["x1", "x2", "x3"])
  );
}
{
  // grp: kode indeks (variabel teks), rank: kode numerik 1..4 (variabel ordinal)
  const r = mulberry32(2);
  datasets.push(
    dataset("categorical", 400, () => {
      const x1 = r3(r() * 4 - 2), grp = Math.floor(r() * 3), rank = 1 + Math.floor(r() * 4);
      const eta = -0.3 + 0.8 * x1 + [0.4, -0.5, 0][grp] + [0.6, 0.2, -0.3, 0][rank - 1];
      return { values: [x1, grp, rank], label: logistic(eta, r()) };
    }, ["x1", "grp", "rank"], [1, 2])
  );
}
{
  // Kasus overshoot Newton nyata dari fixture irls_core (kolom 0 = intercept dibuang)
  const fixture = JSON.parse(
    readFileSync(resolve(frontend, "components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/testdata/irls_core_cases.json"), "utf8")
  );
  const c = fixture.cases.find((cs) => cs.name === "step_halving");
  datasets.push(
    dataset("step_halving", c.n, (i) => ({ values: c.x.slice(i * c.p + 1, (i + 1) * c.p), label: c.y[i] }), Array.from({ length: c.p - 1 }, (_, j) => `v${j + 1}`))
  );
}
{
  // Hampir terpisah: koefisien besar → peringatan separasi
  const r = mulberry32(3);
  datasets.push(
    dataset("near_separation", 60, (i) => {
      const x1 = r3(r() * 6 - 3);
      return { values: [x1, r3(r())], label: (x1 > 0) !== (i === 7) ? 1 : 0 };
    }, ["x1", "noise"])
  );
}
{
  // Kolinear sempurna: x2 = 2·x1 → Hessian singular, eskalasi ridge, pseudo-inverse
  const r = mulberry32(4);
  datasets.push(
    dataset("collinear", 120, () => {
      const x1 = r3(r() * 2 - 1);
      return { values: [x1, 2 * x1], label: logistic(0.5 * x1, r()) };
    }, ["x1", "x2"])
  );
}
{
  const r = mulberry32(5);
  datasets.push(
    dataset("zero_column", 80, () => {
      const x1 = r3(r() * 2 - 1);
      return { values: [x1, 0], label: logistic(x1, r()) };
    }, ["x1", "zero"])
  );
}
{
  const r = mulberry32(6);
  datasets.push(
    dataset("small_categorical", 18, () => {
      const g = Math.floor(r() * 3);
      return { values: [g, r3(r())], label: r() < 0.5 ? 1 : 0 };
    }, ["g", "x"], [0])
  );
}

function compare(a, b, path, out) {
  if (typeof a === "number" || typeof b === "number" || a === null || b === null) {
    if (a === null && b === null) return;
    if (typeof a !== "number" || typeof b !== "number") {
      out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      return;
    }
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    if (!(Math.abs(a - b) <= TOL * scale)) out.push(`${path}: ${a} vs ${b} (Δ=${Math.abs(a - b)})`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.push(`${path}: array length ${a?.length} vs ${b?.length}`);
      return;
    }
    a.forEach((v, i) => compare(v, b[i], `${path}[${i}]`, out));
    return;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) out.push(`${path}: keys [${ka}] vs [${kb}]`);
    for (const k of ka) if (k in b) compare(a[k], b[k], `${path}.${k}`, out);
    return;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

/** Selisih absolut maksimum dan selisih berskala maksimum (skala sama dengan compare). */
function maxDiffs(a, b) {
  let abs = 0;
  let scaled = 0;
  const walk = (x, y) => {
    if (typeof x === "number" && typeof y === "number") {
      const d = Math.abs(x - y);
      abs = Math.max(abs, d);
      scaled = Math.max(scaled, d / Math.max(1, Math.abs(x), Math.abs(y)));
    } else if (x && y && typeof x === "object") for (const k of Object.keys(x)) walk(x[k], y[k]);
  };
  walk(a, b);
  return { abs, scaled };
}

let failures = 0;
for (const d of datasets) {
  const fn = JSON.stringify(d.featureNames);
  const js = calculateBinaryLogistic(d.x, d.n, d.cols, d.y, d.config, fn);
  const rustJson = wasm.calculate_binary_logistic(d.x, d.n, d.cols, d.y, d.config, fn);
  const rust = JSON.parse(rustJson);
  const diffs = [];
  compare(js, rust, "result", diffs);
  // Ekspor ber-timer (mode C/D workload full) harus menghasilkan string JSON yang identik
  const timedJson = wasm.calculate_binary_logistic_timed(d.x, d.n, d.cols, d.y, d.config, fn);
  const [analysisMs, serializeMs] = wasm.last_full_timings();
  if (timedJson !== rustJson) diffs.push("calculate_binary_logistic_timed: JSON differs from calculate_binary_logistic");
  if (!(analysisMs >= 0 && serializeMs >= 0)) diffs.push(`last_full_timings: invalid [${analysisMs}, ${serializeMs}]`);
  const warn = rust.fitting_warnings ? ` warnings=${rust.fitting_warnings.messages.length}` : "";
  if (diffs.length === 0) {
    const { abs, scaled } = maxDiffs(js, rust);
    console.log(`PASS ${d.name} (n=${d.n}, max|Δ|=${abs.toExponential(2)}, max scaled Δ=${scaled.toExponential(2)}${warn})`);
  } else {
    failures++;
    console.log(`FAIL ${d.name}: ${diffs.length} difference(s)`);
    for (const line of diffs.slice(0, 15)) console.log(`  ${line}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
