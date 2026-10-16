/**
 * Inti IRLS regresi logistik biner untuk eksperimen 2×2
 * (JavaScript vs Rust-Wasm × main thread vs Web Worker).
 *
 * File ini SENGAJA berupa ES module mandiri tanpa dependency dan disajikan
 * apa adanya dari /public. Mode A (main thread) memuatnya lewat dynamic
 * import dengan magic comment webpackIgnore, dan mode B (jsCore.worker.js)
 * lewat `import ... from "./irls_core.js"`, sehingga kedua mode menjalankan
 * byte kode yang sama persis (tidak ditranspilasi Next/SWC).
 *
 * Algoritma WAJIB identik dengan versi Rust:
 *   components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/irls_core.rs
 * Struktur loop di kedua file dicerminkan baris demi baris. Kalau mengubah
 * salah satunya, ubah juga yang lain dan perbarui golden values di
 * rust/src/bench/testdata/irls_core_cases.json.
 *
 * Spesifikasinya meniru `irls::fit` produksi (rust/src/stats/irls.rs) tanpa
 * cek condition number berbasis SVD, tanpa eskalasi ridge, dan tanpa
 * early-stop deteksi separasi. Lihat BinaryLogisticExperiment/EXPERIMENT.md.
 */

export const PROB_MIN = 1e-10;
export const PROB_MAX = 1 - 1e-10;
export const W_MIN = 1e-10;
export const RIDGE = 1e-9;
export const MAX_HALVING = 10;
export const HALVING = 0.5;
// HALVING^MAX_HALVING = 0.5^10, langkah terkecil saat step-halving gagal
const MIN_STEP = HALVING ** MAX_HALVING;

/**
 * @param {Float64Array} X  row-major n×p, kolom 0 = intercept (semua 1)
 * @param {Float64Array} y  0/1, panjang n
 * @param {number} n
 * @param {number} p
 * @param {number} [maxIter=20]
 * @param {number} [tol=0.001]
 * @returns {{ beta: Float64Array, se: Float64Array, neg2ll: number,
 *             iterations: number, converged: boolean, stepHalvings: number }}
 */
export function irlsCore(X, y, n, p, maxIter = 20, tol = 0.001) {
  if (!(X instanceof Float64Array) || !(y instanceof Float64Array)) {
    throw new TypeError("irlsCore: X dan y harus Float64Array");
  }
  if (!Number.isInteger(n) || !Number.isInteger(p) || n < 1 || p < 1) {
    throw new Error("irlsCore: n dan p harus bilangan bulat >= 1");
  }
  if (X.length !== n * p) {
    throw new Error(`irlsCore: panjang X harus n*p = ${n * p}, aktual ${X.length}`);
  }
  if (y.length !== n) {
    throw new Error(`irlsCore: panjang y harus n = ${n}, aktual ${y.length}`);
  }
  if (!Number.isInteger(maxIter) || maxIter < 1) {
    throw new Error("irlsCore: maxIter harus bilangan bulat >= 1");
  }
  if (!(tol > 0)) {
    throw new Error("irlsCore: tol harus > 0");
  }

  // Semua buffer dialokasikan sekali di sini; tidak ada alokasi di dalam loop.
  const beta = new Float64Array(p);
  const betaNew = new Float64Array(p);
  const betaPrev = new Float64Array(p);
  const delta = new Float64Array(p);
  const g = new Float64Array(p);
  const z = new Float64Array(p);
  const H = new Float64Array(p * p);
  const se = new Float64Array(p);
  let mu = new Float64Array(n);
  let muNew = new Float64Array(n);

  let llPrev = -Infinity;
  let converged = false;
  let iterations = 0;
  let stepHalvings = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // 1-4. mu dari beta, w, g = Xᵀ(y - mu), H = XᵀWX (segitiga atas)
    g.fill(0);
    H.fill(0);
    for (let i = 0; i < n; i++) {
      const row = i * p;
      let eta = 0;
      for (let j = 0; j < p; j++) eta += X[row + j] * beta[j];
      let m = 1 / (1 + Math.exp(-eta));
      if (m < PROB_MIN) m = PROB_MIN;
      else if (m > PROB_MAX) m = PROB_MAX;
      mu[i] = m;
      let wi = m * (1 - m);
      if (wi < W_MIN) wi = W_MIN;
      const ri = y[i] - m;
      for (let a = 0; a < p; a++) {
        const xa = X[row + a];
        g[a] += xa * ri;
        const xaw = xa * wi;
        const ha = a * p;
        for (let b = a; b < p; b++) H[ha + b] += xaw * X[row + b];
      }
    }
    // Cerminkan segitiga atas ke bawah, lalu ridge pada diagonal
    for (let a = 0; a < p; a++) {
      H[a * p + a] += RIDGE;
      for (let b = a + 1; b < p; b++) H[b * p + a] = H[a * p + b];
    }

    // 5. delta = solve(H, g) via Cholesky
    if (!choleskyInPlace(H, p)) {
      throw new Error(
        `Cholesky gagal pada iterasi ${iter + 1}: Hessian tidak positive definite`
      );
    }
    choleskySolve(H, p, g, delta, z);

    // 6. Log-likelihood acuan
    const llCur = iter === 0 ? logLik(y, mu, n) : llPrev;

    // 7. Step-halving, meniru step_halving_search produksi
    let step = 1;
    for (let j = 0; j < p; j++) betaNew[j] = beta[j] + delta[j];
    let llNew = muAndLogLik(X, y, betaNew, n, p, muNew);
    for (let h = 0; h < MAX_HALVING; h++) {
      if (llNew > llCur || llCur === -Infinity) break;
      step *= HALVING;
      for (let j = 0; j < p; j++) betaNew[j] = beta[j] + step * delta[j];
      llNew = muAndLogLik(X, y, betaNew, n, p, muNew);
      stepHalvings++;
    }
    if (llNew < llCur && llCur !== -Infinity) {
      step = MIN_STEP;
      for (let j = 0; j < p; j++) betaNew[j] = beta[j] + step * delta[j];
      llNew = muAndLogLik(X, y, betaNew, n, p, muNew);
    }

    // 8. beta_prev = beta; beta = beta_new; mu = mu_new
    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      betaPrev[j] = beta[j];
      beta[j] = betaNew[j];
      const d = Math.abs(beta[j] - betaPrev[j]);
      if (d > maxChange) maxChange = d;
    }
    const tmp = mu;
    mu = muNew;
    muNew = tmp;

    // 9. Konvergensi (minimal 2 iterasi, sama seperti produksi)
    if (iter > 0 && maxChange < tol) {
      converged = true;
      break;
    }
    llPrev = llNew;
  }

  // Kovarians = (XᵀWX)⁻¹ TANPA ridge, w dari mu final
  H.fill(0);
  for (let i = 0; i < n; i++) {
    const row = i * p;
    const m = mu[i];
    let wi = m * (1 - m);
    if (wi < W_MIN) wi = W_MIN;
    for (let a = 0; a < p; a++) {
      const xaw = X[row + a] * wi;
      const ha = a * p;
      for (let b = a; b < p; b++) H[ha + b] += xaw * X[row + b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = a + 1; b < p; b++) H[b * p + a] = H[a * p + b];
  }
  if (!choleskyInPlace(H, p)) {
    throw new Error(
      "Cholesky gagal saat menghitung kovarians: X'WX tidak positive definite " +
        "(cek kolom nol/konstan atau kolinearitas sempurna)"
    );
  }
  // se_j = sqrt(diag((L Lᵀ)⁻¹)_j) = ||L⁻¹ e_j||, lewat substitusi maju L v = e_j
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let k = j; k < p; k++) {
      let t = k === j ? 1 : 0;
      const rk = k * p;
      for (let q = j; q < k; q++) t -= H[rk + q] * z[q];
      const v = t / H[rk + k];
      z[k] = v;
      s += v * v;
    }
    se[j] = Math.sqrt(s);
  }

  const neg2ll = -2 * logLik(y, mu, n);

  return { beta, se, neg2ll, iterations, converged, stepHalvings };
}

// LL(mu) = Σ y ln(clamp(mu)) + (1-y) ln(1-clamp(mu))
function logLik(y, mu, n) {
  let ll = 0;
  for (let i = 0; i < n; i++) {
    let m = mu[i];
    if (m < PROB_MIN) m = PROB_MIN;
    else if (m > PROB_MAX) m = PROB_MAX;
    const yi = y[i];
    ll += yi * Math.log(m) + (1 - yi) * Math.log(1 - m);
  }
  return ll;
}

// Hitung muOut = clamp(sigmoid(X·beta)) dan kembalikan LL(muOut) dalam satu lintasan.
// Nilai identik dengan compute_predictions + calculate_log_likelihood_safe produksi.
function muAndLogLik(X, y, beta, n, p, muOut) {
  let ll = 0;
  for (let i = 0; i < n; i++) {
    const row = i * p;
    let eta = 0;
    for (let j = 0; j < p; j++) eta += X[row + j] * beta[j];
    let m = 1 / (1 + Math.exp(-eta));
    if (m < PROB_MIN) m = PROB_MIN;
    else if (m > PROB_MAX) m = PROB_MAX;
    muOut[i] = m;
    const yi = y[i];
    ll += yi * Math.log(m) + (1 - yi) * Math.log(1 - m);
  }
  return ll;
}

// Faktorisasi Cholesky in-place (Cholesky–Crout per kolom): segitiga bawah A
// menjadi L dengan A = L Lᵀ. Mengembalikan false jika A tidak positive
// definite (pivot <= 0 atau NaN). Segitiga atas tidak disentuh.
function choleskyInPlace(A, p) {
  for (let j = 0; j < p; j++) {
    const rj = j * p;
    let d = A[rj + j];
    for (let k = 0; k < j; k++) d -= A[rj + k] * A[rj + k];
    if (!(d > 0)) return false;
    const ljj = Math.sqrt(d);
    A[rj + j] = ljj;
    for (let i = j + 1; i < p; i++) {
      const ri = i * p;
      let s = A[ri + j];
      for (let k = 0; k < j; k++) s -= A[ri + k] * A[rj + k];
      A[ri + j] = s / ljj;
    }
  }
  return true;
}

// Selesaikan (L Lᵀ) x = b dengan substitusi maju lalu mundur; z buffer kerja.
function choleskySolve(L, p, b, x, z) {
  for (let i = 0; i < p; i++) {
    const ri = i * p;
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[ri + k] * z[k];
    z[i] = s / L[ri + i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k];
    x[i] = s / L[i * p + i];
  }
}
