//! Analisis lengkap metode Enter dengan pencatatan waktu di dalam Wasm, untuk
//! workload "full" eksperimen 2×2 (mode C/D).
//!
//! Memanggil fungsi internal produksi yang sama dengan `calculate_binary_logistic`
//! di lib.rs (parsing config, `stats::design_matrix::build`,
//! `strategies::enter::run`, `serde_json::to_string`) dengan validasi dan pesan
//! error yang sama, sehingga string JSON hasilnya identik. Bedanya hanya tiga
//! titik waktu: awal → hasil analisis siap → JSON siap. Fungsi produksi tidak
//! diubah dan tidak dipakai di sini.

use std::cell::Cell;

use nalgebra::{DMatrix, DVector};
use wasm_bindgen::prelude::*;

use crate::models::config::{LogisticConfig, RegressionMethod};
use crate::{stats, strategies};

/// Durasi di dalam Wasm (ms).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EnterTimings {
    /// Parsing config + design matrix + seluruh analisis Enter, tanpa serialisasi.
    pub analysis_ms: f64,
    /// `serde_json::to_string` atas hasil.
    pub serialize_ms: f64,
}

/// Jalur Enter `calculate_binary_logistic` dalam Rust murni (tanpa JsValue),
/// dengan jam yang disuntikkan agar bisa diuji di luar wasm32.
pub fn run_enter_json(
    data_x: &[f64],
    rows: usize,
    cols: usize,
    data_y: &[f64],
    config_json: &str,
    feature_names_json: &str,
    now: &dyn Fn() -> f64,
) -> Result<(String, EnterTimings), String> {
    let t0 = now();

    // A. Parse Konfigurasi (pesan error sama dengan lib.rs)
    let config: LogisticConfig =
        serde_json::from_str(config_json).map_err(|e| format!("Gagal parsing config JSON: {}", e))?;
    let feature_names: Vec<String> =
        serde_json::from_str(feature_names_json).map_err(|e| format!("Gagal parsing feature names: {}", e))?;
    if feature_names.len() != cols {
        return Err(format!(
            "Mismatch features: Matrix cols={}, Names provided={}",
            cols,
            feature_names.len()
        ));
    }

    // B. Validasi Dimensi Data
    if rows == 0 || cols == 0 {
        return Err("Data input kosong (rows atau cols = 0)".to_string());
    }
    if data_x.len() != rows * cols {
        return Err(format!(
            "Dimensi data X salah. Harapan: {}, Aktual: {}",
            rows * cols,
            data_x.len()
        ));
    }
    if data_y.len() != rows {
        return Err("Dimensi data Y tidak sesuai dengan jumlah baris X".to_string());
    }
    if config.method != RegressionMethod::Enter {
        return Err("calculate_binary_logistic_timed hanya mendukung metode Enter".to_string());
    }

    // C. Matrix mentah → design matrix (dummy kategorik)
    let x_matrix_raw = DMatrix::from_row_slice(rows, cols, data_x);
    let y_vector = DVector::from_column_slice(data_y);
    let design = stats::design_matrix::build(&x_matrix_raw, &feature_names, &config)
        .map_err(|e| format!("Design Matrix Error: {}", e))?;

    // D. Metode Enter
    let result = strategies::enter::run(
        &design.matrix,
        &y_vector,
        &config,
        &design.feature_names,
        Some(design.codings),
        &design.variable_groups,
    )
    .map_err(|e| format!("Error di Metode Enter: {}", e))?;
    let t1 = now();

    // E. Serialisasi hasil
    let json = serde_json::to_string(&result).map_err(|e| format!("Gagal serialize output: {}", e))?;
    let t2 = now();

    Ok((json, EnterTimings { analysis_ms: t1 - t0, serialize_ms: t2 - t1 }))
}

thread_local! {
    static LAST_TIMINGS: Cell<[f64; 2]> = const { Cell::new([f64::NAN, f64::NAN]) };
}

/// Sama dengan `calculate_binary_logistic` produksi untuk metode Enter (string
/// JSON identik), ditambah pencatatan waktu di dalam Wasm. Waktunya dibaca
/// setelah timer JavaScript berhenti lewat `last_full_timings()`, supaya
/// jalur kembali panggilan yang diukur tetap sama (satu string JSON).
#[wasm_bindgen]
pub fn calculate_binary_logistic_timed(
    data_x: &[f64],
    rows: usize,
    cols: usize,
    data_y: &[f64],
    config_json: String,
    feature_names_json: String,
) -> Result<JsValue, JsValue> {
    LAST_TIMINGS.with(|c| c.set([f64::NAN, f64::NAN]));
    let (json, t) = run_enter_json(data_x, rows, cols, data_y, &config_json, &feature_names_json, &super::now_ms)
        .map_err(|e| JsValue::from_str(&e))?;
    LAST_TIMINGS.with(|c| c.set([t.analysis_ms, t.serialize_ms]));
    Ok(JsValue::from_str(&json))
}

/// `[analysisMs, serializeMs]` dari panggilan `calculate_binary_logistic_timed`
/// terakhir (NaN bila gagal atau di luar wasm32).
#[wasm_bindgen]
pub fn last_full_timings() -> Vec<f64> {
    LAST_TIMINGS.with(|c| c.get().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const CONFIG: &str = r#"{"dependent_index":0,"independent_indices":[],
        "categoricalVariables":[{"columnIndex":1,"method":"Indicator","reference":"Last"}],
        "max_iterations":20,"convergence_threshold":0.001,"include_constant":true,"confidence_level":95,
        "cutoff":0.5,"method":"Enter","p_entry":0.05,"p_removal":0.1,"hosmer_lemeshow":false,
        "classification_plots":false,"casewise_listing":false,"casewise_type":"outliers","casewise_outliers":2.0,
        "iteration_history":false,"correlations":false,"display_at_last_step":false,
        "save_predicted_probabilities":false,"save_predicted_group":false,"save_residuals_unstandardized":false,
        "save_residuals_logit":false,"save_residuals_studentized":false,"save_residuals_standardized":false,
        "save_residuals_deviance":false,"save_influence_cooks":false,"save_influence_leverage":false,
        "save_influence_dfbeta":false,"assumptions":{"multicollinearity":false,"box_tidwell":false}}"#;

    /// Data deterministik: x1 numerik, grp kategorik (kode 0/1/2), y biner.
    fn dataset(n: usize) -> (Vec<f64>, Vec<f64>) {
        let mut x = Vec::with_capacity(n * 2);
        let mut y = Vec::with_capacity(n);
        for i in 0..n {
            let x1 = ((i * 37) % 101) as f64 / 25.0 - 2.0;
            let grp = (i % 3) as f64;
            let eta = -0.3 + 0.9 * x1 + if grp == 0.0 { 0.4 } else { -0.2 };
            let u = ((i * 7919) % 1000) as f64 / 1000.0;
            x.push(x1);
            x.push(grp);
            y.push(if u < 1.0 / (1.0 + (-eta).exp()) { 1.0 } else { 0.0 });
        }
        (x, y)
    }

    fn fake_clock(ticks: Vec<f64>) -> impl Fn() -> f64 {
        let ticks = RefCell::new(ticks.into_iter());
        move || ticks.borrow_mut().next().unwrap_or(f64::NAN)
    }

    #[test]
    fn hasil_json_enter_lengkap_dan_waktu_dari_jam() {
        let (x, y) = dataset(120);
        let clock = fake_clock(vec![100.0, 112.5, 113.0]);
        let (json, t) = run_enter_json(&x, 120, 2, &y, CONFIG, r#"["x1","grp"]"#, &clock).unwrap();
        assert_eq!(t, EnterTimings { analysis_ms: 12.5, serialize_ms: 0.5 });
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        for key in ["model_summary", "classification_table", "variables_in_equation", "block_0_constant", "omni_tests"] {
            assert!(v.get(key).is_some(), "kunci {} tidak ada", key);
        }
        let labels: Vec<&str> = v["variables_in_equation"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["label"].as_str().unwrap())
            .collect();
        assert!(labels.contains(&"x1") && labels.contains(&"grp(1)") && labels.contains(&"grp(2)") && labels.contains(&"Constant"));
    }

    #[test]
    fn deterministik_untuk_input_sama() {
        let (x, y) = dataset(90);
        let a = run_enter_json(&x, 90, 2, &y, CONFIG, r#"["x1","grp"]"#, &|| 0.0).unwrap().0;
        let b = run_enter_json(&x, 90, 2, &y, CONFIG, r#"["x1","grp"]"#, &|| 0.0).unwrap().0;
        assert_eq!(a, b);
    }

    #[test]
    fn validasi_sama_dengan_produksi() {
        let (x, y) = dataset(30);
        let err = run_enter_json(&x, 30, 2, &y, CONFIG, r#"["x1"]"#, &|| 0.0).unwrap_err();
        assert_eq!(err, "Mismatch features: Matrix cols=2, Names provided=1");
        let err = run_enter_json(&x[..10], 30, 2, &y, CONFIG, r#"["x1","grp"]"#, &|| 0.0).unwrap_err();
        assert_eq!(err, "Dimensi data X salah. Harapan: 60, Aktual: 10");
        let forward = CONFIG.replace(r#""method":"Enter""#, r#""method":"ForwardLR""#);
        let err = run_enter_json(&x, 30, 2, &y, &forward, r#"["x1","grp"]"#, &|| 0.0).unwrap_err();
        assert!(err.contains("hanya mendukung metode Enter"));
    }
}
