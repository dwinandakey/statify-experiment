//! Inti IRLS regresi logistik biner untuk eksperimen 2×2
//! (JavaScript vs Rust-Wasm × main thread vs Web Worker).
//!
//! Cermin baris demi baris dari
//!   frontend/public/workers/Regression/BinaryExperiment/irls_core.js
//! Kalau mengubah salah satunya, ubah juga yang lain dan buat ulang golden
//! values di testdata/irls_core_cases.json
//! (BinaryLogisticExperiment/scripts/genIrlsFixtures.mjs).
//!
//! Sengaja TIDAK memakai nalgebra: slice f64 row-major, loop biasa, dan
//! Cholesky tulisan sendiri, supaya perbedaan JS vs Wasm murni berasal dari
//! runtime, bukan dari library aljabar. Spesifikasinya meniru `irls::fit`
//! produksi tanpa cek condition number berbasis SVD, tanpa eskalasi ridge,
//! dan tanpa early-stop deteksi separasi.

use serde::Serialize;

pub const PROB_MIN: f64 = 1e-10;
pub const PROB_MAX: f64 = 1.0 - 1e-10;
pub const W_MIN: f64 = 1e-10;
pub const RIDGE: f64 = 1e-9;
pub const MAX_HALVING: usize = 10;
pub const HALVING: f64 = 0.5;
// HALVING^MAX_HALVING = 0.5^10, langkah terkecil saat step-halving gagal
const MIN_STEP: f64 = 0.0009765625;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrlsCoreResult {
    pub beta: Vec<f64>,
    pub se: Vec<f64>,
    pub neg2ll: f64,
    pub iterations: u32,
    pub converged: bool,
    pub step_halvings: u32,
}

/// `x`: row-major n×p dengan kolom 0 = intercept (semua 1); `y`: 0/1 panjang n.
pub fn irls_core(
    x: &[f64],
    y: &[f64],
    n: usize,
    p: usize,
    max_iter: usize,
    tol: f64,
) -> Result<IrlsCoreResult, String> {
    if n < 1 || p < 1 {
        return Err("irlsCore: n dan p harus bilangan bulat >= 1".to_string());
    }
    if x.len() != n * p {
        return Err(format!(
            "irlsCore: panjang X harus n*p = {}, aktual {}",
            n * p,
            x.len()
        ));
    }
    if y.len() != n {
        return Err(format!(
            "irlsCore: panjang y harus n = {}, aktual {}",
            n,
            y.len()
        ));
    }
    if max_iter < 1 {
        return Err("irlsCore: maxIter harus bilangan bulat >= 1".to_string());
    }
    if !(tol > 0.0) {
        return Err("irlsCore: tol harus > 0".to_string());
    }

    // Semua buffer dialokasikan sekali di sini; tidak ada alokasi di dalam loop.
    let mut beta = vec![0.0_f64; p];
    let mut beta_new = vec![0.0_f64; p];
    let mut beta_prev = vec![0.0_f64; p];
    let mut delta = vec![0.0_f64; p];
    let mut g = vec![0.0_f64; p];
    let mut z = vec![0.0_f64; p];
    let mut hess = vec![0.0_f64; p * p];
    let mut se = vec![0.0_f64; p];
    let mut mu = vec![0.0_f64; n];
    let mut mu_new = vec![0.0_f64; n];

    let mut ll_prev = f64::NEG_INFINITY;
    let mut converged = false;
    let mut iterations: usize = 0;
    let mut step_halvings: usize = 0;

    for iter in 0..max_iter {
        iterations = iter + 1;

        // 1-4. mu dari beta, w, g = Xᵀ(y - mu), H = XᵀWX (segitiga atas)
        g.fill(0.0);
        hess.fill(0.0);
        for i in 0..n {
            let row = i * p;
            let mut eta = 0.0;
            for j in 0..p {
                eta += x[row + j] * beta[j];
            }
            let mut m = 1.0 / (1.0 + (-eta).exp());
            if m < PROB_MIN {
                m = PROB_MIN;
            } else if m > PROB_MAX {
                m = PROB_MAX;
            }
            mu[i] = m;
            let mut wi = m * (1.0 - m);
            if wi < W_MIN {
                wi = W_MIN;
            }
            let ri = y[i] - m;
            for a in 0..p {
                let xa = x[row + a];
                g[a] += xa * ri;
                let xaw = xa * wi;
                let ha = a * p;
                for b in a..p {
                    hess[ha + b] += xaw * x[row + b];
                }
            }
        }
        // Cerminkan segitiga atas ke bawah, lalu ridge pada diagonal
        for a in 0..p {
            hess[a * p + a] += RIDGE;
            for b in (a + 1)..p {
                hess[b * p + a] = hess[a * p + b];
            }
        }

        // 5. delta = solve(H, g) via Cholesky
        if !cholesky_in_place(&mut hess, p) {
            return Err(format!(
                "Cholesky gagal pada iterasi {}: Hessian tidak positive definite",
                iter + 1
            ));
        }
        cholesky_solve(&hess, p, &g, &mut delta, &mut z);

        // 6. Log-likelihood acuan
        let ll_cur = if iter == 0 { log_lik(y, &mu, n) } else { ll_prev };

        // 7. Step-halving, meniru step_halving_search produksi
        let mut step = 1.0;
        for j in 0..p {
            beta_new[j] = beta[j] + delta[j];
        }
        let mut ll_new = mu_and_log_lik(x, y, &beta_new, n, p, &mut mu_new);
        for _ in 0..MAX_HALVING {
            if ll_new > ll_cur || ll_cur == f64::NEG_INFINITY {
                break;
            }
            step *= HALVING;
            for j in 0..p {
                beta_new[j] = beta[j] + step * delta[j];
            }
            ll_new = mu_and_log_lik(x, y, &beta_new, n, p, &mut mu_new);
            step_halvings += 1;
        }
        if ll_new < ll_cur && ll_cur != f64::NEG_INFINITY {
            step = MIN_STEP;
            for j in 0..p {
                beta_new[j] = beta[j] + step * delta[j];
            }
            ll_new = mu_and_log_lik(x, y, &beta_new, n, p, &mut mu_new);
        }

        // 8. beta_prev = beta; beta = beta_new; mu = mu_new
        let mut max_change = 0.0;
        for j in 0..p {
            beta_prev[j] = beta[j];
            beta[j] = beta_new[j];
            let d = (beta[j] - beta_prev[j]).abs();
            if d > max_change {
                max_change = d;
            }
        }
        std::mem::swap(&mut mu, &mut mu_new);

        // 9. Konvergensi (minimal 2 iterasi, sama seperti produksi)
        if iter > 0 && max_change < tol {
            converged = true;
            break;
        }
        ll_prev = ll_new;
    }

    // Kovarians = (XᵀWX)⁻¹ TANPA ridge, w dari mu final
    hess.fill(0.0);
    for i in 0..n {
        let row = i * p;
        let m = mu[i];
        let mut wi = m * (1.0 - m);
        if wi < W_MIN {
            wi = W_MIN;
        }
        for a in 0..p {
            let xaw = x[row + a] * wi;
            let ha = a * p;
            for b in a..p {
                hess[ha + b] += xaw * x[row + b];
            }
        }
    }
    for a in 0..p {
        for b in (a + 1)..p {
            hess[b * p + a] = hess[a * p + b];
        }
    }
    if !cholesky_in_place(&mut hess, p) {
        return Err("Cholesky gagal saat menghitung kovarians: X'WX tidak positive definite \
                    (cek kolom nol/konstan atau kolinearitas sempurna)"
            .to_string());
    }
    // se_j = sqrt(diag((L Lᵀ)⁻¹)_j) = ||L⁻¹ e_j||, lewat substitusi maju L v = e_j
    for j in 0..p {
        let mut s = 0.0;
        for k in j..p {
            let mut t = if k == j { 1.0 } else { 0.0 };
            let rk = k * p;
            for q in j..k {
                t -= hess[rk + q] * z[q];
            }
            let v = t / hess[rk + k];
            z[k] = v;
            s += v * v;
        }
        se[j] = s.sqrt();
    }

    let neg2ll = -2.0 * log_lik(y, &mu, n);

    Ok(IrlsCoreResult {
        beta,
        se,
        neg2ll,
        iterations: iterations as u32,
        converged,
        step_halvings: step_halvings as u32,
    })
}

// LL(mu) = Σ y ln(clamp(mu)) + (1-y) ln(1-clamp(mu))
fn log_lik(y: &[f64], mu: &[f64], n: usize) -> f64 {
    let mut ll = 0.0;
    for i in 0..n {
        let mut m = mu[i];
        if m < PROB_MIN {
            m = PROB_MIN;
        } else if m > PROB_MAX {
            m = PROB_MAX;
        }
        let yi = y[i];
        ll += yi * m.ln() + (1.0 - yi) * (1.0 - m).ln();
    }
    ll
}

// Hitung mu_out = clamp(sigmoid(X·beta)) dan kembalikan LL(mu_out) dalam satu lintasan.
// Nilai identik dengan compute_predictions + calculate_log_likelihood_safe produksi.
fn mu_and_log_lik(
    x: &[f64],
    y: &[f64],
    beta: &[f64],
    n: usize,
    p: usize,
    mu_out: &mut [f64],
) -> f64 {
    let mut ll = 0.0;
    for i in 0..n {
        let row = i * p;
        let mut eta = 0.0;
        for j in 0..p {
            eta += x[row + j] * beta[j];
        }
        let mut m = 1.0 / (1.0 + (-eta).exp());
        if m < PROB_MIN {
            m = PROB_MIN;
        } else if m > PROB_MAX {
            m = PROB_MAX;
        }
        mu_out[i] = m;
        let yi = y[i];
        ll += yi * m.ln() + (1.0 - yi) * (1.0 - m).ln();
    }
    ll
}

// Faktorisasi Cholesky in-place (Cholesky–Crout per kolom): segitiga bawah A
// menjadi L dengan A = L Lᵀ. Mengembalikan false jika A tidak positive
// definite (pivot <= 0 atau NaN). Segitiga atas tidak disentuh.
fn cholesky_in_place(a: &mut [f64], p: usize) -> bool {
    for j in 0..p {
        let rj = j * p;
        let mut d = a[rj + j];
        for k in 0..j {
            d -= a[rj + k] * a[rj + k];
        }
        if !(d > 0.0) {
            return false;
        }
        let ljj = d.sqrt();
        a[rj + j] = ljj;
        for i in (j + 1)..p {
            let ri = i * p;
            let mut s = a[ri + j];
            for k in 0..j {
                s -= a[ri + k] * a[rj + k];
            }
            a[ri + j] = s / ljj;
        }
    }
    true
}

// Selesaikan (L Lᵀ) x = b dengan substitusi maju lalu mundur; z buffer kerja.
fn cholesky_solve(l: &[f64], p: usize, b: &[f64], x: &mut [f64], z: &mut [f64]) {
    for i in 0..p {
        let ri = i * p;
        let mut s = b[i];
        for k in 0..i {
            s -= l[ri + k] * z[k];
        }
        z[i] = s / l[ri + i];
    }
    for i in (0..p).rev() {
        let mut s = z[i];
        for k in (i + 1)..p {
            s -= l[k * p + i] * x[k];
        }
        x[i] = s / l[i * p + i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{DMatrix, DVector};
    use serde::Deserialize;

    /// Toleransi kecocokan dengan golden values dari irls_core.js
    const GOLDEN_TOL: f64 = 1e-10;

    #[derive(Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        n: usize,
        p: usize,
        x: Vec<f64>,
        y: Vec<f64>,
        max_iter: usize,
        tol: f64,
        #[serde(default)]
        closed_form: Option<ClosedForm>,
        expected: Expected,
    }

    #[derive(Deserialize)]
    struct ClosedForm {
        n00: f64,
        n01: f64,
        n10: f64,
        n11: f64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        #[serde(default)]
        beta: Vec<f64>,
        #[serde(default)]
        se: Vec<f64>,
        #[serde(default)]
        neg2ll: f64,
        #[serde(default)]
        iterations: u32,
        #[serde(default)]
        converged: bool,
        #[serde(default)]
        step_halvings: u32,
        #[serde(default)]
        error: Option<String>,
    }

    fn cases() -> Vec<Case> {
        let fixture: Fixture = serde_json::from_str(include_str!("testdata/irls_core_cases.json"))
            .expect("testdata/irls_core_cases.json harus JSON valid");
        fixture.cases
    }

    fn case(name: &str) -> Case {
        cases()
            .into_iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("kasus {} tidak ada di fixture", name))
    }

    fn run(c: &Case) -> Result<IrlsCoreResult, String> {
        irls_core(&c.x, &c.y, c.n, c.p, c.max_iter, c.tol)
    }

    fn max_abs_diff(a: &[f64], b: &[f64]) -> f64 {
        assert_eq!(a.len(), b.len());
        a.iter()
            .zip(b.iter())
            .map(|(u, v)| (u - v).abs())
            .fold(0.0, f64::max)
    }

    #[test]
    fn golden_values_cocok_dengan_irls_core_js() {
        let all = cases();
        assert!(all.len() >= 5);
        for c in &all {
            match (&c.expected.error, run(c)) {
                (None, Ok(r)) => {
                    let e = &c.expected;
                    let db = max_abs_diff(&r.beta, &e.beta);
                    let ds = max_abs_diff(&r.se, &e.se);
                    let dl = (r.neg2ll - e.neg2ll).abs();
                    println!("golden {}: max|Δβ|={:e} max|ΔSE|={:e} |Δ-2LL|={:e}", c.name, db, ds, dl);
                    assert!(db < GOLDEN_TOL, "{}: |beta - golden| = {:e}", c.name, db);
                    assert!(ds < GOLDEN_TOL, "{}: |se - golden| = {:e}", c.name, ds);
                    assert!(dl < GOLDEN_TOL, "{}: |neg2ll - golden| = {:e}", c.name, dl);
                    assert_eq!(r.iterations, e.iterations, "{}: iterations", c.name);
                    assert_eq!(r.converged, e.converged, "{}: converged", c.name);
                    assert_eq!(r.step_halvings, e.step_halvings, "{}: stepHalvings", c.name);
                }
                (Some(msg), Err(err)) => assert_eq!(&err, msg, "{}: pesan error", c.name),
                (Some(_), Ok(_)) => panic!("{}: seharusnya error", c.name),
                (None, Err(err)) => panic!("{}: error tak terduga: {}", c.name, err),
            }
        }
    }

    #[test]
    fn tabel_2x2_cocok_dengan_solusi_tertutup() {
        let c = case("two_by_two");
        let cf = c.closed_form.as_ref().expect("closedForm ada");
        let b0 = (cf.n01 / cf.n00).ln();
        let b1 = (cf.n11 / cf.n10).ln() - b0;
        let se0 = (1.0 / cf.n00 + 1.0 / cf.n01).sqrt();
        let se1 = (1.0 / cf.n00 + 1.0 / cf.n01 + 1.0 / cf.n10 + 1.0 / cf.n11).sqrt();

        let r = run(&c).unwrap();
        assert!(r.converged);
        assert!((r.beta[0] - b0).abs() < 1e-6);
        assert!((r.beta[1] - b1).abs() < 1e-6);
        assert!((r.se[0] - se0).abs() < 1e-6);
        assert!((r.se[1] - se1).abs() < 1e-6);
    }

    /// Pembanding independen: `irls::fit` produksi (nalgebra). Untuk data
    /// well-conditioned keduanya menjalankan algoritma yang sama, hanya urutan
    /// penjumlahan BLAS yang berbeda.
    #[test]
    fn cocok_dengan_irls_fit_produksi() {
        for name in ["synthetic_n60_p3", "two_by_two", "step_halving", "max_iter_2"] {
            let c = case(name);
            let r = run(&c).unwrap();
            let xm = DMatrix::from_row_slice(c.n, c.p, &c.x);
            let yv = DVector::from_column_slice(&c.y);
            let prod = crate::stats::irls::fit(&xm, &yv, c.max_iter, c.tol).unwrap();
            let prod_se: Vec<f64> = (0..c.p)
                .map(|j| prod.covariance_matrix[(j, j)].sqrt())
                .collect();

            let db = max_abs_diff(&r.beta, prod.beta.as_slice());
            let ds = max_abs_diff(&r.se, &prod_se);
            let dl = (r.neg2ll + 2.0 * prod.final_log_likelihood).abs();
            println!("produksi {}: max|Δβ|={:e} max|ΔSE|={:e} |Δ-2LL|={:e}", name, db, ds, dl);
            assert!(db < 1e-8, "{}: |beta - produksi| = {:e}", name, db);
            assert!(ds < 1e-8, "{}: |se - produksi| = {:e}", name, ds);
            assert!(dl < 1e-8, "{}: |neg2ll - produksi| = {:e}", name, dl);
            assert_eq!(r.iterations as usize, prod.iterations, "{}: iterations", name);
            assert_eq!(r.converged, prod.converged, "{}: converged", name);
            assert_eq!(
                r.step_halvings as usize, prod.warnings.step_halving_count,
                "{}: stepHalvings",
                name
            );
        }
    }

    #[test]
    fn kolom_nol_gagal_di_cholesky_kovarians() {
        let c = case("zero_column_cholesky_fail");
        let err = run(&c).unwrap_err();
        assert!(err.starts_with("Cholesky gagal saat menghitung kovarians"), "{}", err);
    }

    #[test]
    fn nan_gagal_di_cholesky_iterasi_pertama() {
        let c = case("synthetic_n60_p3");
        let mut x = c.x.clone();
        x[4] = f64::NAN;
        let err = irls_core(&x, &c.y, c.n, c.p, 20, 0.001).unwrap_err();
        assert!(err.starts_with("Cholesky gagal pada iterasi 1"), "{}", err);
    }

    #[test]
    fn validasi_dimensi_input() {
        let x = vec![0.0; 6];
        let y = vec![0.0; 3];
        assert!(irls_core(&x, &y, 3, 3, 20, 0.001).unwrap_err().contains("panjang X"));
        assert!(irls_core(&x, &[0.0; 2], 3, 2, 20, 0.001).unwrap_err().contains("panjang y"));
        assert!(irls_core(&x, &y, 3, 2, 0, 0.001).unwrap_err().contains("maxIter"));
        assert!(irls_core(&x, &y, 3, 2, 20, 0.0).unwrap_err().contains("tol"));
    }

    #[test]
    fn min_step_sama_dengan_halving_pangkat_max_halving() {
        assert_eq!(MIN_STEP, HALVING.powi(MAX_HALVING as i32));
    }
}
