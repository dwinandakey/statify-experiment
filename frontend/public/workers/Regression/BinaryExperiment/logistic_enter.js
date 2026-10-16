/**
 * Port JavaScript dari `calculate_binary_logistic` produksi untuk metode
 * Enter (crate BinaryLogistic/rust: lib.rs → design_matrix::build →
 * strategies/enter.rs → stats/irls.rs, score_test.rs, wald.rs, table.rs).
 *
 * Dipakai mode A (main thread) dan B (jsCore.worker.js) saat tombol OK di
 * dialog "Binary Logistic (Experiment)": hasilnya objek dengan struktur
 * JSON yang sama dengan keluaran Rust (nama field snake_case, field Option
 * yang None dihilangkan, angka non-finite → null seperti serde_json), lalu
 * diformat oleh formatter produksi menjadi tabel SPSS. Mode C/D memanggil
 * fungsi Rust aslinya dari paket wasm eksperimen.
 *
 * Cakupan: metode Enter dengan opsi default dialog produksi (tanpa Hosmer-
 * Lemeshow, casewise, plot, iteration history, korelasi, save, asumsi) dan
 * kontras kategorik Indicator. Keputusan algoritmik (ambang condition
 * number, eskalasi ridge, step-halving, deteksi separasi, jalur fallback
 * Cholesky → LU → SVD, pesan peringatan) mengikuti kode Rust; angka cocok
 * hingga tingkat pembulatan karena urutan operasi BLAS nalgebra tidak ditiru.
 * Paritas dengan Rust dicek oleh
 * BinaryLogisticExperiment/scripts/checkEnterParity.mjs.
 */

// --- Konstanta stats/irls.rs ---
const PROB_MIN = 1e-10;
const PROB_MAX = 1 - 1e-10;
const BETA_EXPLOSION_THRESHOLD = 20;
const EXTREME_PROB_THRESHOLD = 1e-6;
const EXTREME_PROB_RATIO = 0.1;
const MAX_STEP_HALVING = 10;
const STEP_HALVING_FACTOR = 0.5;
const INITIAL_LAMBDA = 1e-9;
const MAX_LAMBDA = 1e-3;
const LAMBDA_INCREASE_FACTOR = 10;
const CONDITION_NUMBER_THRESHOLD = 1e10;

// ======================================================================
// Distribusi (statrs 0.16): ChiSquared::cdf → gamma_lr, Normal::inverse_cdf
// ======================================================================

const GAMMA_R = 10.900511;
const GAMMA_DK = [
  2.48574089138753565546e-5, 1.0514237858172197421, -3.45687097222016235469, 4.512277094668948237,
  -2.98285225323576655721, 1.05639711577126713077, -1.95428773191645869583e-1, 1.70970543404441224307e-2,
  -5.71926117404305781283e-4, 4.63399473359905636708e-6, -2.7199490848860770391e-9,
];
const LN_PI = 1.1447298858494001741434273513530587116472948129153;
const LN_2_SQRT_E_OVER_PI = 0.6207822376352452223455184457816472122518527279025978;

function lnGamma(x) {
  if (x < 0.5) {
    let s = GAMMA_DK[0];
    for (let i = 1; i < GAMMA_DK.length; i++) s += GAMMA_DK[i] / (i - x);
    return LN_PI - Math.log(Math.sin(Math.PI * x)) - Math.log(s) - LN_2_SQRT_E_OVER_PI -
      (0.5 - x) * Math.log((0.5 - x + GAMMA_R) / Math.E);
  }
  let s = GAMMA_DK[0];
  for (let i = 1; i < GAMMA_DK.length; i++) s += GAMMA_DK[i] / (x + i - 1);
  return Math.log(s) + LN_2_SQRT_E_OVER_PI + (x - 0.5) * Math.log((x - 0.5 + GAMMA_R) / Math.E);
}

/** Regularized lower incomplete gamma P(a, x), statrs `checked_gamma_lr`. */
function gammaLr(a, x) {
  if (Number.isNaN(a) || Number.isNaN(x)) return NaN;
  if (a <= 0 || a === Infinity || x <= 0 || x === Infinity) {
    throw new Error("gamma_lr: argument out of range");
  }
  const eps = 0.000000000000001;
  const big = 4503599627370496.0;
  const bigInv = 2.22044604925031308085e-16;
  if (Math.abs(a) <= 1e-15) return 1.0; // prec::almost_eq(a, 0, DEFAULT_F64_ACC)
  if (Math.abs(x) <= 1e-15) return 0.0;

  const ax = a * Math.log(x) - x - lnGamma(a);
  if (ax < -709.78271289338399) return a < x ? 1.0 : 0.0;

  if (x <= 1.0 || x <= a) {
    let r2 = a;
    let c2 = 1.0;
    let ans2 = 1.0;
    for (;;) {
      r2 += 1.0;
      c2 *= x / r2;
      ans2 += c2;
      if (c2 / ans2 <= eps) break;
    }
    return (Math.exp(ax) * ans2) / a;
  }

  let y = 1.0 - a;
  let z = x + y + 1.0;
  let c = 0;
  let p3 = 1.0;
  let q3 = x;
  let p2 = x + 1.0;
  let q2 = z * x;
  let ans = p2 / q2;
  for (;;) {
    y += 1.0;
    z += 2.0;
    c += 1;
    const yc = y * c;
    const p = p2 * z - p3 * yc;
    const q = q2 * z - q3 * yc;
    p3 = p2;
    p2 = p;
    q3 = q2;
    q2 = q;
    if (Math.abs(p) > big) {
      p3 *= bigInv;
      p2 *= bigInv;
      q3 *= bigInv;
      q2 *= bigInv;
    }
    if (q !== 0) {
      const nextans = p / q;
      const error = Math.abs((ans - nextans) / nextans);
      ans = nextans;
      if (error <= eps) break;
    }
  }
  return 1.0 - Math.exp(ax) * ans;
}

/** statrs ChiSquared::new(df).cdf(x) = Gamma(df/2, rate 0.5).cdf(x). */
function chiSquaredCdf(x, df) {
  if (x <= 0) return 0.0;
  if (x === Infinity) return 1.0;
  return gammaLr(df / 2, x * 0.5);
}

/** Kuantil normal baku (Wichura AS241, presisi ~1e-16). */
function normalInverseCdf(prob) {
  const q = prob - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r +
          133.14166789178437745) * r + 3.387132872796366608)) /
      (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r +
        42.313330701600911252) * r + 1.0)
    );
  }
  let r = q < 0 ? prob : 1 - prob;
  r = Math.sqrt(-Math.log(r));
  let val;
  if (r <= 5) {
    r -= 1.6;
    val =
      (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
        1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r +
        4.6303378461565452959) * r + 1.42343711074968357734) /
      (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
        0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r +
        2.05319162663775882187) * r + 1.0);
  } else {
    r -= 5;
    val =
      (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
        0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r +
        5.4637849111641143699) * r + 6.6579046435011037772) /
      (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r +
        0.59983220655588793769) * r + 1.0);
  }
  return q < 0 ? -val : val;
}

/** utils/probability.rs z_score_from_confidence. */
function zScoreFromConfidence(confidenceLevel) {
  const conf = confidenceLevel > 1.0 ? confidenceLevel / 100.0 : confidenceLevel;
  const alpha = 1.0 - conf;
  return normalInverseCdf(1.0 - alpha / 2.0);
}

// ======================================================================
// Aljabar matriks kecil (row-major Float64Array p×p), semantik nalgebra
// ======================================================================

function hasNonFinite(arr) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return true;
  return false;
}

function withRidge(A, p, lambda) {
  const out = Float64Array.from(A);
  for (let i = 0; i < p; i++) out[i * p + i] += lambda;
  return out;
}

/** Cholesky nalgebra: gagal bila pivot nol, negatif, atau NaN. Mengembalikan L (segitiga bawah). */
function cholesky(A, p) {
  const L = Float64Array.from(A);
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) {
      const factor = L[j * p + k];
      for (let r = j; r < p; r++) L[r * p + j] -= factor * L[r * p + k];
    }
    const diag = L[j * p + j];
    if (!(diag > 0)) return null;
    const denom = Math.sqrt(diag);
    L[j * p + j] = denom;
    for (let r = j + 1; r < p; r++) L[r * p + j] /= denom;
  }
  for (let r = 0; r < p; r++) for (let c = r + 1; c < p; c++) L[r * p + c] = 0;
  return L;
}

function choleskySolve(L, p, b) {
  const x = Float64Array.from(b);
  for (let i = 0; i < p; i++) {
    x[i] /= L[i * p + i];
    for (let r = i + 1; r < p; r++) x[r] -= L[r * p + i] * x[i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let dot = 0;
    for (let r = i + 1; r < p; r++) dot += L[r * p + i] * x[r];
    x[i] = (x[i] - dot) / L[i * p + i];
  }
  return x;
}

/** LU dengan pivot parsial (nalgebra LU::new): pivot nol dilewati, bukan error. */
function luDecompose(A, p) {
  const lu = Float64Array.from(A);
  const perm = [];
  for (let i = 0; i < p; i++) {
    let piv = i;
    let best = Math.abs(lu[i * p + i]);
    for (let r = i + 1; r < p; r++) {
      const v = Math.abs(lu[r * p + i]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    const diag = lu[piv * p + i];
    if (diag === 0) continue;
    if (piv !== i) {
      perm.push([i, piv]);
      for (let c = 0; c < p; c++) {
        const t = lu[i * p + c];
        lu[i * p + c] = lu[piv * p + c];
        lu[piv * p + c] = t;
      }
    }
    const invDiag = 1 / diag;
    for (let r = i + 1; r < p; r++) {
      const l = lu[r * p + i] * invDiag;
      lu[r * p + i] = l;
      for (let c = i + 1; c < p; c++) lu[r * p + c] -= l * lu[i * p + c];
    }
  }
  return { lu, perm };
}

/** Selesaikan LU x = P b; null bila diagonal U nol (nalgebra solve_upper_triangular gagal). */
function luSolveWith({ lu, perm }, p, b) {
  const x = Float64Array.from(b);
  for (const [i, j] of perm) {
    const t = x[i];
    x[i] = x[j];
    x[j] = t;
  }
  for (let i = 0; i < p; i++) {
    for (let r = i + 1; r < p; r++) x[r] -= lu[r * p + i] * x[i];
  }
  for (let i = p - 1; i >= 0; i--) {
    const diag = lu[i * p + i];
    if (diag === 0) return null;
    x[i] /= diag;
    for (let r = 0; r < i; r++) x[r] -= lu[r * p + i] * x[i];
  }
  return x;
}

function luSolve(A, p, b) {
  return luSolveWith(luDecompose(A, p), p, b);
}

/** nalgebra try_inverse: rumus tertutup untuk dimensi 1–4, LU untuk >4; null bila determinan/pivot nol. */
function tryInverse(A, p) {
  if (p === 0) return new Float64Array(0);
  if (p === 1) {
    const det = A[0];
    if (det === 0) return null;
    return Float64Array.of(1 / det);
  }
  if (p === 2) {
    const [m11, m12, m21, m22] = A;
    const det = m11 * m22 - m21 * m12;
    if (det === 0) return null;
    return Float64Array.of(m22 / det, -m12 / det, -m21 / det, m11 / det);
  }
  if (p === 3) {
    const [m11, m12, m13, m21, m22, m23, m31, m32, m33] = A;
    const minor_m12_m23 = m22 * m33 - m32 * m23;
    const minor_m11_m23 = m21 * m33 - m31 * m23;
    const minor_m11_m22 = m21 * m32 - m31 * m22;
    const det = m11 * minor_m12_m23 - m12 * minor_m11_m23 + m13 * minor_m11_m22;
    if (det === 0) return null;
    return Float64Array.of(
      minor_m12_m23 / det,
      (m13 * m32 - m33 * m12) / det,
      (m12 * m23 - m22 * m13) / det,
      -minor_m11_m23 / det,
      (m11 * m33 - m31 * m13) / det,
      (m13 * m21 - m23 * m11) / det,
      minor_m11_m22 / det,
      (m12 * m31 - m32 * m11) / det,
      (m11 * m22 - m21 * m12) / det
    );
  }
  if (p === 4) return inverse4(A);
  // >4: LU (nalgebra lu::try_invert_to): pivot nol → gagal
  const dec = luDecompose(A, p);
  for (let i = 0; i < p; i++) if (dec.lu[i * p + i] === 0) return null;
  const inv = new Float64Array(p * p);
  const e = new Float64Array(p);
  for (let c = 0; c < p; c++) {
    e.fill(0);
    e[c] = 1;
    const col = luSolveWith(dec, p, e);
    if (!col) return null;
    for (let r = 0; r < p; r++) inv[r * p + c] = col[r];
  }
  return inv;
}

/** nalgebra do_inverse4 (kofaktor); m = penyimpanan column-major. */
function inverse4(A) {
  const m = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[c * 4 + r] = A[r * 4 + c];
  const o = new Float64Array(16); // row-major, o[i*4+j] = out(i, j)
  const set = (i, j, v) => (o[i * 4 + j] = v);
  set(0, 0, m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]);
  set(1, 0, -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]);
  set(2, 0, m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]);
  set(3, 0, -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]);
  set(0, 1, -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]);
  set(1, 1, m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]);
  set(2, 1, -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]);
  set(3, 1, m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]);
  set(0, 2, m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]);
  set(1, 2, -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]);
  set(2, 2, m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]);
  set(0, 3, -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]);
  set(3, 2, -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]);
  set(1, 3, m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]);
  set(2, 3, -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]);
  set(3, 3, m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]);
  const det = m[0] * o[0] + m[1] * o[1] + m[2] * o[2] + m[3] * o[3];
  if (det === 0) return null;
  const invDet = 1 / det;
  for (let i = 0; i < 16; i++) o[i] *= invDet;
  return o;
}

/**
 * Dekomposisi eigen matriks simetris (Jacobi siklik). Untuk matriks simetris,
 * nilai singular = |eigenvalue|, jadi ini menggantikan SVD nalgebra pada
 * estimasi condition number dan solve/pseudo-inverse berbasis SVD.
 */
function symmetricEigen(A, p) {
  const a = Float64Array.from(A);
  const v = new Float64Array(p * p);
  for (let i = 0; i < p; i++) v[i * p + i] = 1;
  if (hasNonFinite(a)) return { values: new Float64Array(p).fill(NaN), vectors: v };
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    let total = 0;
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        const sq = a[i * p + j] * a[i * p + j];
        total += sq;
        if (i !== j) off += sq;
      }
    }
    if (off === 0 || off <= 1e-34 * total) break;
    for (let i = 0; i < p - 1; i++) {
      for (let j = i + 1; j < p; j++) {
        const aij = a[i * p + j];
        if (aij === 0) continue;
        const theta = (a[j * p + j] - a[i * p + i]) / (2 * aij);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < p; k++) {
          const aki = a[k * p + i];
          const akj = a[k * p + j];
          a[k * p + i] = c * aki - s * akj;
          a[k * p + j] = s * aki + c * akj;
        }
        for (let k = 0; k < p; k++) {
          const aik = a[i * p + k];
          const ajk = a[j * p + k];
          a[i * p + k] = c * aik - s * ajk;
          a[j * p + k] = s * aik + c * ajk;
        }
        for (let k = 0; k < p; k++) {
          const vki = v[k * p + i];
          const vkj = v[k * p + j];
          v[k * p + i] = c * vki - s * vkj;
          v[k * p + j] = s * vki + c * vkj;
        }
      }
    }
  }
  const values = new Float64Array(p);
  for (let i = 0; i < p; i++) values[i] = a[i * p + i];
  return { values, vectors: v };
}

/** irls.rs estimate_condition_number: max σ / min σ, ∞ bila min σ ≤ 1e-15. */
function conditionNumber(A, p) {
  const { values } = symmetricEigen(A, p);
  let maxSv = 0;
  let minSv = Number.MAX_VALUE;
  for (const ev of values) {
    const sv = Math.abs(ev);
    if (sv > maxSv) maxSv = sv;
    if (sv < minSv) minSv = sv;
  }
  if (p > 0 && minSv > 1e-15) return maxSv / minSv;
  return Infinity;
}

/** nalgebra SVD::solve(b, eps) untuk matriks simetris: nilai singular ≤ eps dianggap nol. */
function svdSolve(A, p, b, eps) {
  const { values, vectors } = symmetricEigen(A, p);
  const x = new Float64Array(p);
  for (let k = 0; k < p; k++) {
    const lambda = values[k];
    if (!(Math.abs(lambda) > eps)) continue;
    let dot = 0;
    for (let i = 0; i < p; i++) dot += vectors[i * p + k] * b[i];
    const coef = dot / lambda;
    for (let i = 0; i < p; i++) x[i] += coef * vectors[i * p + k];
  }
  return x;
}

/** nalgebra SVD::pseudo_inverse(eps) untuk matriks simetris. */
function pseudoInverse(A, p, eps) {
  const { values, vectors } = symmetricEigen(A, p);
  const out = new Float64Array(p * p);
  for (let k = 0; k < p; k++) {
    const lambda = values[k];
    if (!(Math.abs(lambda) > eps)) continue;
    for (let i = 0; i < p; i++) {
      const vik = vectors[i * p + k] / lambda;
      for (let j = 0; j < p; j++) out[i * p + j] += vik * vectors[j * p + k];
    }
  }
  return out;
}

function identity(p) {
  const out = new Float64Array(p * p);
  for (let i = 0; i < p; i++) out[i * p + i] = 1;
  return out;
}

/** u · (A⁻¹ u) lewat Cholesky, fallback try_inverse, lalu 0 (pola score_test.rs / wald.rs). */
function quadraticFormInverse(A, k, u) {
  const L = cholesky(A, k);
  if (L) {
    const sol = choleskySolve(L, k, u);
    let s = 0;
    for (let i = 0; i < k; i++) s += u[i] * sol[i];
    return s;
  }
  const inv = tryInverse(A, k);
  if (inv) {
    let s = 0;
    for (let i = 0; i < k; i++) {
      let term = 0;
      for (let j = 0; j < k; j++) term += inv[i * k + j] * u[j];
      s += u[i] * term;
    }
    return s;
  }
  return 0.0;
}

// ======================================================================
// IRLS (stats/irls.rs fit)
// ======================================================================

function safeSigmoid(z) {
  const prob = 1 / (1 + Math.exp(-z));
  return prob < PROB_MIN ? PROB_MIN : prob > PROB_MAX ? PROB_MAX : prob;
}

function weightOf(pi) {
  const w = pi * (1 - pi);
  return w < 1e-10 ? 1e-10 : w;
}

function computePredictions(X, n, p, beta, out) {
  for (let i = 0; i < n; i++) {
    const row = i * p;
    let eta = 0;
    for (let j = 0; j < p; j++) eta += X[row + j] * beta[j];
    out[i] = safeSigmoid(eta);
  }
  return out;
}

function logLikelihood(y, mu, n) {
  let ll = 0;
  for (let i = 0; i < n; i++) {
    let m = mu[i];
    m = m < PROB_MIN ? PROB_MIN : m > PROB_MAX ? PROB_MAX : m;
    ll += y[i] * Math.log(m) + (1 - y[i]) * Math.log(1 - m);
  }
  return ll;
}

/** XᵀWX (simetris penuh) dengan bobot per baris. */
function weightedCrossProduct(X, n, p, weights) {
  const H = new Float64Array(p * p);
  for (let i = 0; i < n; i++) {
    const row = i * p;
    const wi = weights[i];
    for (let a = 0; a < p; a++) {
      const xaw = X[row + a] * wi;
      const ha = a * p;
      for (let b = a; b < p; b++) H[ha + b] += xaw * X[row + b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) H[b * p + a] = H[a * p + b];
  return H;
}

function newWarnings() {
  return {
    possible_separation: false,
    quasi_separation: false,
    step_halving_used: false,
    step_halving_count: 0,
    ridge_increased: false,
    final_lambda: 0,
    near_singular_hessian: false,
    messages: [],
  };
}

/** irls.rs solve_linear_system: ridge adaptif + Cholesky → LU → SVD → ridge berat → delta nol. */
function solveLinearSystem(hessian, p, gradient, lambda, warnings) {
  let current = lambda;
  for (let attempt = 0; attempt < 5; attempt++) {
    const reg = withRidge(hessian, p, current);
    if (conditionNumber(reg, p) > CONDITION_NUMBER_THRESHOLD) {
      warnings.near_singular_hessian = true;
      current *= LAMBDA_INCREASE_FACTOR;
      if (current > MAX_LAMBDA) current = MAX_LAMBDA;
      warnings.ridge_increased = true;
      continue;
    }
    const L = cholesky(reg, p);
    if (L) {
      const delta = choleskySolve(L, p, gradient);
      if (!hasNonFinite(delta)) {
        warnings.final_lambda = current;
        return [delta, current];
      }
    }
    const luDelta = luSolve(reg, p, gradient);
    if (luDelta && !hasNonFinite(luDelta)) {
      warnings.final_lambda = current;
      return [luDelta, current];
    }
    const svdDelta = svdSolve(reg, p, gradient, 1e-10);
    if (!hasNonFinite(svdDelta)) {
      warnings.final_lambda = current;
      return [svdDelta, current];
    }
    current *= LAMBDA_INCREASE_FACTOR;
    if (current > MAX_LAMBDA) current = MAX_LAMBDA;
    warnings.ridge_increased = true;
    if (attempt === 4) {
      warnings.near_singular_hessian = true;
      warnings.messages.push(
        "Warning: Hessian matrix is severely ill-conditioned. Results may be unreliable. This often indicates perfect multicollinearity among predictors."
      );
      const heavy = svdSolve(withRidge(hessian, p, MAX_LAMBDA), p, gradient, 1e-8);
      if (!hasNonFinite(heavy)) {
        warnings.final_lambda = MAX_LAMBDA;
        return [heavy, MAX_LAMBDA];
      }
      warnings.messages.push(
        "Warning: Could not solve linear system even with heavy regularization. Using last available parameter estimates."
      );
      warnings.final_lambda = MAX_LAMBDA;
      return [new Float64Array(p), MAX_LAMBDA];
    }
  }
  warnings.near_singular_hessian = true;
  warnings.messages.push("Warning: Hessian matrix is singular. Using last available parameter estimates.");
  return [new Float64Array(p), MAX_LAMBDA];
}

function stepHalvingSearch(X, n, p, y, betaOld, delta, llOld, warnings) {
  let stepSize = 1.0;
  let betaNew = new Float64Array(p);
  for (let j = 0; j < p; j++) betaNew[j] = betaOld[j] + delta[j];
  let muNew = computePredictions(X, n, p, betaNew, new Float64Array(n));
  let llNew = logLikelihood(y, muNew, n);
  for (let h = 0; h < MAX_STEP_HALVING; h++) {
    if (llNew > llOld || llOld === -Infinity) break;
    stepSize *= STEP_HALVING_FACTOR;
    for (let j = 0; j < p; j++) betaNew[j] = betaOld[j] + delta[j] * stepSize;
    computePredictions(X, n, p, betaNew, muNew);
    llNew = logLikelihood(y, muNew, n);
    warnings.step_halving_used = true;
    warnings.step_halving_count += 1;
  }
  if (llNew < llOld && llOld !== -Infinity) {
    stepSize = STEP_HALVING_FACTOR ** MAX_STEP_HALVING;
    betaNew = new Float64Array(p);
    for (let j = 0; j < p; j++) betaNew[j] = betaOld[j] + delta[j] * stepSize;
    computePredictions(X, n, p, betaNew, muNew);
    llNew = logLikelihood(y, muNew, n);
    warnings.messages.push(
      "Warning: Step-halving did not improve log-likelihood. Algorithm may be near a saddle point or the model may not be appropriate."
    );
  }
  return { beta: betaNew, ll: llNew, mu: muNew };
}

function detectSeparation(beta, predictions, warnings) {
  let maxBeta = 0;
  for (const b of beta) {
    const a = Math.abs(b);
    if (a > maxBeta) maxBeta = a;
  }
  if (maxBeta > BETA_EXPLOSION_THRESHOLD) {
    warnings.possible_separation = true;
    warnings.messages.push(
      `Warning: Large coefficient detected (|β| = ${maxBeta.toFixed(2)}). Possible complete or quasi-complete separation.`
    );
  }
  const n = predictions.length;
  let extreme = 0;
  for (let i = 0; i < n; i++) {
    const pr = predictions[i];
    if (pr < EXTREME_PROB_THRESHOLD || pr > 1 - EXTREME_PROB_THRESHOLD) extreme++;
  }
  const ratio = extreme / n;
  if (ratio > EXTREME_PROB_RATIO) {
    warnings.quasi_separation = true;
    if (!warnings.possible_separation) {
      warnings.messages.push(
        `Warning: ${(ratio * 100).toFixed(1)}% of predicted probabilities are extreme (< 1e-6 or > 1e0). This may indicate quasi-complete separation.`
      );
    }
  }
}

/** irls.rs fit (tanpa iteration history). X row-major n×p. */
function fit(X, n, p, y, maxIter, tol) {
  let beta = new Float64Array(p);
  let betaPrev = new Float64Array(p);
  let llPrev = -Infinity;
  let currentLambda = INITIAL_LAMBDA;
  let predictions = new Float64Array(n).fill(0.5);
  let weights = new Float64Array(n);
  let converged = false;
  let finalIter = 0;
  const warnings = newWarnings();
  const mu = new Float64Array(n);
  const w = new Float64Array(n);
  const residuals = new Float64Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    finalIter = iter + 1;
    computePredictions(X, n, p, beta, mu);
    for (let i = 0; i < n; i++) {
      w[i] = weightOf(mu[i]);
      residuals[i] = y[i] - mu[i];
    }
    const gradient = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const row = i * p;
      const ri = residuals[i];
      for (let j = 0; j < p; j++) gradient[j] += X[row + j] * ri;
    }
    const hessian = weightedCrossProduct(X, n, p, w);

    const [delta, newLambda] = solveLinearSystem(hessian, p, gradient, currentLambda, warnings);
    currentLambda = newLambda;

    const llCurrent = iter === 0 ? logLikelihood(y, mu, n) : llPrev;
    const step = stepHalvingSearch(X, n, p, y, beta, delta, llCurrent, warnings);
    beta = step.beta;
    predictions = step.mu;
    weights = new Float64Array(n);
    for (let i = 0; i < n; i++) weights[i] = weightOf(predictions[i]);

    detectSeparation(beta, predictions, warnings);

    let paramChange = 0;
    for (let j = 0; j < p; j++) {
      const d = Math.abs(beta[j] - betaPrev[j]);
      if (d > paramChange) paramChange = d;
    }
    if (paramChange < tol && iter > 0) {
      converged = true;
      break;
    }
    llPrev = step.ll;
    betaPrev = Float64Array.from(beta);

    if (warnings.possible_separation && iter > Math.floor(maxIter / 2)) {
      warnings.messages.push(`Warning: Stopping early at iteration ${finalIter} due to possible separation.`);
      break;
    }
  }

  // Kovarians: inverse Hessian murni, fallback ridge, lalu pseudo-inverse
  const pure = weightedCrossProduct(X, n, p, weights);
  const regularized = withRidge(pure, p, currentLambda);
  const smallRegNote = "Note: Small regularization applied to compute covariance matrix.";
  let cov;
  const inv = tryInverse(pure, p);
  if (inv) {
    if (hasNonFinite(inv)) {
      const invReg = tryInverse(regularized, p);
      if (invReg && !hasNonFinite(invReg)) {
        warnings.messages.push(smallRegNote);
        cov = invReg;
      } else {
        cov = pseudoInverse(pure, p, 1e-10);
      }
    } else {
      cov = inv;
    }
  } else {
    const invReg = tryInverse(regularized, p);
    if (invReg && !hasNonFinite(invReg)) {
      warnings.messages.push(smallRegNote);
      cov = invReg;
    } else {
      cov = pseudoInverse(pure, p, 1e-10);
    }
  }
  warnings.final_lambda = currentLambda;

  return {
    beta,
    cov,
    predictions,
    finalLogLikelihood: logLikelihood(y, predictions, n),
    iterations: finalIter,
    converged,
    warnings,
  };
}

// ======================================================================
// Statistik pendukung (score_test.rs, wald.rs, table.rs)
// ======================================================================

function classificationTable(predicted, observed, cutoff) {
  let o0p0 = 0;
  let o0p1 = 0;
  let o1p0 = 0;
  let o1p1 = 0;
  const epsilon = 1e-10;
  for (let i = 0; i < predicted.length; i++) {
    const predictedClass = predicted[i] >= cutoff - epsilon ? 1.0 : 0.0;
    const obs = observed[i];
    const isObs0 = Math.abs(obs - 0.0) < 1e-9;
    const isObs1 = Math.abs(obs - 1.0) < 1e-9;
    const isPred0 = Math.abs(predictedClass - 0.0) < 1e-9;
    if (isObs0) {
      if (isPred0) o0p0++;
      else o0p1++;
    } else if (isObs1) {
      if (isPred0) o1p0++;
      else o1p1++;
    }
  }
  const total0 = o0p0 + o0p1;
  const total1 = o1p0 + o1p1;
  const totalAll = total0 + total1;
  return {
    observed_0_predicted_0: o0p0,
    observed_0_predicted_1: o0p1,
    percentage_correct_0: total0 > 0 ? (o0p0 / total0) * 100.0 : 0.0,
    observed_1_predicted_0: o1p0,
    observed_1_predicted_1: o1p1,
    percentage_correct_1: total1 > 0 ? (o1p1 / total1) * 100.0 : 0.0,
    overall_percentage: totalAll > 0 ? ((o0p0 + o1p1) / totalAll) * 100.0 : 0.0,
  };
}

function chiSquareSig(stat, df) {
  return stat > 0 ? 1.0 - chiSquaredCdf(stat, df) : 1.0;
}

/** score_test.rs calculate_single_score_test. */
function singleScoreTest(col, y, nullProb, includeConstant) {
  const n = col.length;
  const wVal = nullProb * (1.0 - nullProb);
  let u = 0;
  let sum = 0;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    u += col[i] * (y[i] - nullProb);
    sum += col[i];
    sqSum += col[i] * col[i];
  }
  const info = includeConstant ? wVal * (sqSum - (sum * sum) / n) : wVal * sqSum;
  const score = info > 1e-12 ? (u * u) / info : 0.0;
  return { score, df: 1, sig: chiSquareSig(score, 1) };
}

/** score_test.rs calculate_single_group_score_test: 1 kolom didelegasikan ke uji tunggal. */
function groupScoreTest(cols, y, nullProb, includeConstant) {
  const k = cols.length;
  if (k === 0) return { score: 0.0, df: 0, sig: 1.0 };
  if (k === 1) return singleScoreTest(cols[0], y, nullProb, includeConstant);
  return matrixScoreTest(cols, y, nullProb, includeConstant);
}

/**
 * Jalur matriks score test: U = Xᵀ(y − p₀), I = w·(XᵀX − s sᵀ/n) (atau w·XᵀX
 * tanpa konstanta), skor = Uᵀ I⁻¹ U. calculate_global_score_test_with_constant
 * selalu memakai jalur ini, juga untuk 1 kolom.
 */
function matrixScoreTest(cols, y, nullProb, includeConstant) {
  const k = cols.length;
  const n = y.length;
  const wVal = nullProb * (1.0 - nullProb);
  const u = new Float64Array(k);
  const sums = new Float64Array(k);
  const xtx = new Float64Array(k * k);
  for (let a = 0; a < k; a++) {
    const ca = cols[a];
    for (let i = 0; i < n; i++) {
      u[a] += ca[i] * (y[i] - nullProb);
      sums[a] += ca[i];
    }
    for (let b = a; b < k; b++) {
      const cb = cols[b];
      let s = 0;
      for (let i = 0; i < n; i++) s += ca[i] * cb[i];
      xtx[a * k + b] = s;
      xtx[b * k + a] = s;
    }
  }
  const info = new Float64Array(k * k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      const base = includeConstant ? xtx[a * k + b] - (sums[a] * sums[b]) / n : xtx[a * k + b];
      info[a * k + b] = base * wVal;
    }
  }
  const score = quadraticFormInverse(info, k, u);
  return { score, df: k, sig: chiSquareSig(score, k) };
}

/** wald.rs calculate_joint_wald_test untuk grup > 1 kolom. */
function jointWaldTest(beta, cov, p, indices) {
  const k = indices.length;
  const b = new Float64Array(k);
  const sub = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    b[i] = beta[indices[i]];
    for (let j = 0; j < k; j++) sub[i * k + j] = cov[indices[i] * p + indices[j]];
  }
  const wald = quadraticFormInverse(sub, k, b);
  return { wald, df: k, sig: chiSquareSig(wald, k) };
}

// ======================================================================
// Design matrix (stats/design_matrix.rs build) — kontras Indicator
// ======================================================================

/** Representasi f64 → String Rust (Display): tanpa notasi eksponen. */
function rustF64ToString(v) {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  const sign = v < 0 ? "-" : "";
  const s = String(Math.abs(v));
  if (!s.includes("e")) return sign + s;
  const [mant, expStr] = s.split("e");
  const exp = Number(expStr);
  const [intPart, fracPart = ""] = mant.split(".");
  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  if (pointPos <= 0) return `${sign}0.${"0".repeat(-pointPos)}${digits}`;
  if (pointPos >= digits.length) return sign + digits + "0".repeat(pointPos - digits.length);
  return `${sign}${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
}

function buildDesignMatrix(rawCols, featureNames, categoricalVariables) {
  const n = rawCols.length > 0 ? rawCols[0].length : 0;
  const catMap = new Map(categoricalVariables.map((c) => [c.column_index, c]));
  const columns = [];
  const names = [];
  const codings = [];
  const groups = [];
  rawCols.forEach((colData, colIdx) => {
    const colName = colIdx < featureNames.length ? featureNames[colIdx] : `Var_${colIdx}`;
    const cat = catMap.get(colIdx);
    if (!cat) {
      groups.push({ name: colName, columnIndices: [columns.length], isCategorical: false });
      columns.push(colData);
      names.push(colName);
      return;
    }
    if (cat.method !== "Indicator") {
      throw new Error(`Contrast method ${cat.method} is not supported by the JavaScript port (Indicator only).`);
    }
    // BTreeMap<String, usize> lalu sort numerik stabil
    const keys = new Array(n);
    const freq = new Map();
    for (let i = 0; i < n; i++) {
      const key = rustF64ToString(colData[i]);
      keys[i] = key;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const categories = [...freq.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    categories.sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : a > b ? 1 : 0;
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    const k = categories.length;
    if (k < 2) {
      columns.push(colData);
      names.push(colName);
      return;
    }
    const refIdx = cat.reference === "First" ? 0 : k - 1;
    const nDummies = k - 1;
    const codesOf = categories.map((_, ci) => {
      const codes = new Array(nDummies).fill(0.0);
      if (ci !== refIdx) {
        const target = refIdx === 0 ? ci - 1 : ci;
        if (target < nDummies) codes[target] = 1.0;
      }
      return codes;
    });
    const indexOf = new Map(categories.map((c, i) => [c, i]));
    const dummyCols = Array.from({ length: nDummies }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const codes = codesOf[indexOf.get(keys[i])];
      for (let d = 0; d < nDummies; d++) dummyCols[d][i] = codes[d];
    }
    const start = columns.length;
    for (let d = 0; d < nDummies; d++) {
      columns.push(dummyCols[d]);
      names.push(`${colName}(${d + 1})`);
    }
    groups.push({ name: colName, columnIndices: Array.from({ length: nDummies }, (_, d) => start + d), isCategorical: true });
    codings.push({
      variable_label: colName,
      categories: categories.map((label, ci) => ({
        category_label: label,
        frequency: freq.get(label),
        parameter_codings: codesOf[ci],
      })),
    });
  });
  if (columns.length === 0) throw new Error("No columns generated for design matrix");
  return { columns, names, codings, groups };
}

// ======================================================================
// strategies/enter.rs run
// ======================================================================

function variableRow(label, b, se, wald, df, sig, z) {
  return {
    label,
    b,
    error: se,
    wald,
    df,
    sig,
    exp_b: Math.exp(b),
    lower_ci: Math.exp(b - z * se),
    upper_ci: Math.exp(b + z * se),
  };
}

function runEnter(design, y, config) {
  const { columns, names, codings, groups } = design;
  const n = y.length;
  const k = columns.length;
  const z = zScoreFromConfidence(config.confidence_level);
  const includeConstant = config.include_constant;

  // --- Block 0 ---
  let nullModel;
  if (includeConstant) {
    nullModel = fit(new Float64Array(n).fill(1), n, 1, y, config.max_iterations, config.convergence_threshold);
  } else {
    nullModel = {
      beta: new Float64Array(0),
      predictions: new Float64Array(n).fill(0.5),
      finalLogLikelihood: n * Math.log(0.5),
      iterations: 0,
      converged: true,
    };
  }
  const nullLl = nullModel.finalLogLikelihood;

  let block0Constant;
  if (includeConstant) {
    let nPositive = 0;
    for (let i = 0; i < n; i++) if (y[i] > 0.5) nPositive++;
    const pr = nPositive / n;
    const pSafe = pr < 1e-10 ? 1e-10 : pr > 1 - 1e-10 ? 1 - 1e-10 : pr;
    const beta0 = Math.log(pSafe / (1.0 - pSafe));
    const se0 = Math.sqrt(1.0 / (n * pSafe * (1.0 - pSafe)));
    const wald0 = se0 > 1e-12 ? (beta0 / se0) ** 2 : 0.0;
    block0Constant = variableRow("Constant", beta0, se0, wald0, 1, chiSquareSig(wald0, 1), z);
  } else {
    block0Constant = { label: "", b: 0, error: 0, wald: 0, df: 0, sig: 1, exp_b: 1, lower_ci: 1, upper_ci: 1 };
  }

  const classTableNull = classificationTable(nullModel.predictions, y, config.cutoff);
  const probNull = nullModel.predictions.length > 0 ? nullModel.predictions[0] : 0.5;

  const varsNotInEq = [];
  for (const group of groups) {
    if (group.columnIndices.length > 1) {
      const t = groupScoreTest(group.columnIndices.map((ci) => columns[ci]), y, probNull, includeConstant);
      varsNotInEq.push({ label: group.name, score: t.score, df: t.df, sig: t.sig });
    }
    for (const ci of group.columnIndices) {
      const t = singleScoreTest(columns[ci], y, probNull, includeConstant);
      varsNotInEq.push({ label: ci < names.length ? names[ci] : `Var_${ci + 1}`, score: t.score, df: 1, sig: t.sig });
    }
  }
  const globalTest = groupScoreTestAll(columns, y, probNull, includeConstant);

  const steps = [
    {
      step: 0,
      action: "Start",
      variable_changed: null,
      summary: {
        log_likelihood: nullLl,
        cox_snell_r_square: 0.0,
        nagelkerke_r_square: 0.0,
        converged: nullModel.converged,
        iterations: nullModel.iterations,
      },
      classification_table: classTableNull,
      variables_in_equation: includeConstant && block0Constant.label === "Constant" ? [block0Constant] : [],
      variables_not_in_equation: varsNotInEq.map((r) => ({ ...r })),
      remainder_test: { chi_square: globalTest.score, df: globalTest.df, sig: globalTest.sig },
    },
  ];

  // --- Block 1: model penuh ---
  const p = includeConstant ? k + 1 : k;
  const offset = includeConstant ? 1 : 0;
  const Xfull = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const row = i * p;
    if (includeConstant) Xfull[row] = 1;
    for (let j = 0; j < k; j++) Xfull[row + offset + j] = columns[j][i];
  }
  const full = fit(Xfull, n, p, y, config.max_iterations, config.convergence_threshold);
  const fullLl = full.finalLogLikelihood;

  const chiSqVal = 2.0 * (fullLl - nullLl);
  const chiSqModel = chiSqVal < 0 ? 0.0 : chiSqVal;
  const omni = {
    chi_square: chiSqModel,
    df: k,
    sig: k > 0 ? 1.0 - chiSquaredCdf(chiSqModel, k) : 1.0,
  };

  const diff = nullLl - fullLl;
  const coxSnell = 1.0 - Math.exp(diff * (2.0 / n));
  const maxCoxSnell = 1.0 - Math.exp(nullLl * (2.0 / n));
  const modelSummary = {
    log_likelihood: fullLl,
    cox_snell_r_square: coxSnell,
    nagelkerke_r_square: maxCoxSnell > 1e-12 ? coxSnell / maxCoxSnell : 0.0,
    converged: full.converged,
    iterations: full.iterations,
  };
  const classTable = classificationTable(full.predictions, y, config.cutoff);

  const rows = [];
  const covAt = (i, j) => full.cov[i * p + j];
  if (includeConstant) {
    const b = full.beta[0];
    const cv = covAt(0, 0);
    const se = cv > 0 ? Math.sqrt(cv) : 0.0;
    const wald = se > 1e-12 ? (b / se) ** 2 : 0.0;
    rows.push(variableRow("Constant", b, se, wald, 1, chiSquareSig(wald, 1), z));
  }
  for (const group of groups) {
    const betaIdx = group.columnIndices.map((ci) => ci + offset);
    if (group.columnIndices.length > 1) {
      const jw = jointWaldTest(full.beta, full.cov, p, betaIdx);
      rows.push({ label: group.name, b: 0, error: 0, wald: jw.wald, df: jw.df, sig: jw.sig, exp_b: 0, lower_ci: 0, upper_ci: 0 });
    }
    for (const ci of group.columnIndices) {
      const bi = ci + offset;
      const b = full.beta[bi];
      const cv = covAt(bi, bi);
      const se = cv > 0 ? Math.sqrt(cv) : 0.0;
      const wald = se > 1e-12 ? (b / se) ** 2 : 0.0;
      rows.push(variableRow(ci < names.length ? names[ci] : `Var_${ci + 1}`, b, se, wald, 1, chiSquareSig(wald, 1), z));
    }
  }

  steps.push({
    step: 1,
    action: "Entered",
    variable_changed: "All Variables",
    summary: { ...modelSummary },
    classification_table: { ...classTable },
    variables_in_equation: rows.map((r) => ({ ...r })),
    variables_not_in_equation: [],
    remainder_test: null,
    omni_tests: { ...omni },
    step_omni_tests: { ...omni },
  });

  const w = full.warnings;
  const hasWarnings =
    w.possible_separation || w.quasi_separation || w.step_halving_used || w.ridge_increased || w.near_singular_hessian || w.messages.length > 0;

  const result = {
    model_info: {
      variables: names.slice(),
      n_total: n,
      n_missing: 0,
      n_selected: n,
      y_encoding: {},
      include_constant: includeConstant,
    },
    model_summary: modelSummary,
    classification_table: classTable,
    variables_in_equation: rows,
    variables_not_in_equation: varsNotInEq,
    overall_remainder_test: { chi_square: globalTest.score, df: globalTest.df, sig: globalTest.sig },
    block_0_constant: block0Constant,
    omni_tests: omni,
    steps_detail: steps,
    method_used: "Enter",
    categorical_codings: codings,
  };
  if (hasWarnings) {
    result.fitting_warnings = {
      possible_separation: w.possible_separation,
      quasi_separation: w.quasi_separation,
      step_halving_used: w.step_halving_used,
      step_halving_count: w.step_halving_count,
      ridge_increased: w.ridge_increased,
      final_lambda: w.final_lambda,
      near_singular_hessian: w.near_singular_hessian,
      messages: w.messages.slice(),
    };
  }
  return result;
}

/** calculate_global_score_test_with_constant: semua kolom design, df = jumlah kolom. */
function groupScoreTestAll(columns, y, nullProb, includeConstant) {
  return matrixScoreTest(columns, y, nullProb, includeConstant);
}

// ======================================================================
// Entri publik: padanan lib.rs calculate_binary_logistic (metode Enter)
// ======================================================================

const UNSUPPORTED_FLAGS = [
  "hosmer_lemeshow",
  "classification_plots",
  "casewise_listing",
  "iteration_history",
  "correlations",
  "save_predicted_probabilities",
  "save_predicted_group",
  "save_residuals_unstandardized",
  "save_residuals_logit",
  "save_residuals_studentized",
  "save_residuals_standardized",
  "save_residuals_deviance",
  "save_influence_cooks",
  "save_influence_leverage",
  "save_influence_dfbeta",
];

const pick = (obj, name, alias, fallback) => (obj[name] !== undefined ? obj[name] : obj[alias] !== undefined ? obj[alias] : fallback);

function parseConfig(configJson) {
  let raw;
  try {
    raw = JSON.parse(configJson);
  } catch (e) {
    throw new Error(`Gagal parsing config JSON: ${e.message}`);
  }
  const method = raw.method ?? "Enter";
  if (method !== "Enter") throw new Error(`The JavaScript port only supports method Enter (got ${method}).`);
  for (const flag of UNSUPPORTED_FLAGS) {
    if (raw[flag] === true) throw new Error(`Option ${flag} is not supported by the JavaScript port (default options only).`);
  }
  const cats = pick(raw, "categorical_variables", "categoricalVariables", []).map((c) => ({
    column_index: pick(c, "column_index", "columnIndex", undefined),
    method: c.method ?? "Indicator",
    reference: c.reference ?? "Last",
  }));
  return {
    categorical_variables: cats,
    include_constant: pick(raw, "include_constant", "includeConstant", true),
    cutoff: raw.cutoff ?? 0.5,
    max_iterations: pick(raw, "max_iterations", "maxIterations", 20),
    convergence_threshold: pick(raw, "convergence_threshold", "convergenceThreshold", 0.001),
    confidence_level: pick(raw, "confidence_level", "confidenceLevel", 0.95),
  };
}

/** serde_json: f64 non-finite diserialisasi sebagai null. */
function toSerdeJsonValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, toSerdeJsonValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = toSerdeJsonValue(v);
    return out;
  }
  return value;
}

/**
 * Padanan JavaScript `calculate_binary_logistic(data_x, rows, cols, data_y,
 * config_json, feature_names_json)`; mengembalikan objek (bukan string JSON).
 */
export function calculateBinaryLogistic(dataX, rows, cols, dataY, configJson, featureNamesJson) {
  const config = parseConfig(configJson);
  let featureNames;
  try {
    featureNames = JSON.parse(featureNamesJson);
  } catch (e) {
    throw new Error(`Gagal parsing feature names: ${e.message}`);
  }
  if (featureNames.length !== cols) {
    throw new Error(`Mismatch features: Matrix cols=${cols}, Names provided=${featureNames.length}`);
  }
  if (rows === 0 || cols === 0) throw new Error("Data input kosong (rows atau cols = 0)");
  if (dataX.length !== rows * cols) {
    throw new Error(`Dimensi data X salah. Harapan: ${rows * cols}, Aktual: ${dataX.length}`);
  }
  if (dataY.length !== rows) throw new Error("Dimensi data Y tidak sesuai dengan jumlah baris X");

  const rawCols = Array.from({ length: cols }, () => new Float64Array(rows));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) rawCols[j][i] = dataX[i * cols + j];
  const y = Float64Array.from(dataY);

  let design;
  try {
    design = buildDesignMatrix(rawCols, featureNames, config.categorical_variables);
  } catch (e) {
    throw new Error(`Design Matrix Error: ${e.message}`);
  }
  let result;
  try {
    result = runEnter(design, y, config);
  } catch (e) {
    throw new Error(`Error di Metode Enter: ${e.message}`);
  }
  return toSerdeJsonValue(result);
}
