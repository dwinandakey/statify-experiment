pub mod bench;
pub mod models;
pub mod stats;
pub mod strategies;
pub mod utils;

use models::config::{LogisticConfig, RegressionMethod};
use nalgebra::{DMatrix, DVector};
use wasm_bindgen::prelude::*;

// Helper untuk format error ke JS
fn api_error(msg: &str) -> JsValue {
    JsValue::from_str(msg)
}

// 1. BINARY LOGISTIC REGRESSION (MAIN)
#[wasm_bindgen]
pub fn calculate_binary_logistic(
    data_x: &[f64],
    rows: usize,
    cols: usize,
    data_y: &[f64],
    config_json: String,
    feature_names_json: String,
) -> Result<JsValue, JsValue> {
    // A. Parse Konfigurasi
    let config: LogisticConfig = serde_json::from_str(&config_json)
        .map_err(|e| api_error(&format!("Gagal parsing config JSON: {}", e)))?;

    let feature_names: Vec<String> = serde_json::from_str(&feature_names_json)
        .map_err(|e| api_error(&format!("Gagal parsing feature names: {}", e)))?;

    // Validasi jumlah nama variabel match dengan cols
    if feature_names.len() != cols {
        return Err(api_error(&format!(
            "Mismatch features: Matrix cols={}, Names provided={}",
            cols,
            feature_names.len()
        )));
    }

    // B. Validasi Dimensi Data
    if rows == 0 || cols == 0 {
        return Err(api_error("Data input kosong (rows atau cols = 0)"));
    }
    if data_x.len() != rows * cols {
        return Err(api_error(&format!(
            "Dimensi data X salah. Harapan: {}, Aktual: {}",
            rows * cols,
            data_x.len()
        )));
    }
    if data_y.len() != rows {
        return Err(api_error(
            "Dimensi data Y tidak sesuai dengan jumlah baris X",
        ));
    }

    // C. Bentuk Matrix & Vector Mentah
    let x_matrix_raw = DMatrix::from_row_slice(rows, cols, data_x);
    let y_vector = DVector::from_column_slice(data_y);

    // --- Panggil Design Matrix Builder ---
    // Ini akan menangani dummy encoding untuk variabel kategorik
    let design_result = stats::design_matrix::build(&x_matrix_raw, &feature_names, &config)
        .map_err(|e| api_error(&format!("Design Matrix Error: {}", e)))?;

    let x_processed = design_result.matrix;
    let final_features = design_result.feature_names;
    let codings = Some(design_result.codings); // Kita bungkus dalam Option
    let variable_groups = design_result.variable_groups;

    // D. Router Metode Regresi
    // Perhatikan: Kita sekarang mengirimkan `x_processed`, `final_features`, dan `codings`
    let result = match config.method {
        RegressionMethod::Enter => {
            strategies::enter::run(&x_processed, &y_vector, &config, &final_features, codings, &variable_groups)
                .map_err(|e| api_error(&format!("Error di Metode Enter: {}", e)))?
        }

        RegressionMethod::ForwardConditional => strategies::forward_conditional::run(
            &x_processed,
            &y_vector,
            &config,
            &final_features,
            codings,
            &variable_groups,
        )
        .map_err(|e| api_error(&format!("Error di Metode Forward Conditional: {:?}", e)))?,

        RegressionMethod::ForwardLR => {
            strategies::forward_lr::run(&x_processed, &y_vector, &config, &final_features, codings, &variable_groups)
                .map_err(|e| api_error(&format!("Error di Metode Forward LR: {:?}", e)))?
        }

        RegressionMethod::ForwardWald => strategies::forward_wald::run(
            &x_processed,
            &y_vector,
            &config,
            &final_features,
            codings,
            &variable_groups,
        )
        .map_err(|e| api_error(&format!("Error di Metode Forward Wald: {:?}", e)))?,

        RegressionMethod::BackwardConditional => strategies::backward_conditional::run(
            &x_processed,
            &y_vector,
            &config,
            &final_features,
            codings,
            &variable_groups,
        )
        .map_err(|e| api_error(&format!("Error di Metode Backward Conditional: {:?}", e)))?,

        RegressionMethod::BackwardLR => {
            strategies::backward_lr::run(&x_processed, &y_vector, &config, &final_features, codings, &variable_groups)
                .map_err(|e| api_error(&format!("Error di Metode Backward LR: {:?}", e)))?
        }

        RegressionMethod::BackwardWald => strategies::backward_wald::run(
            &x_processed,
            &y_vector,
            &config,
            &final_features,
            codings,
            &variable_groups,
        )
        .map_err(|e| api_error(&format!("Error di Metode Backward Wald: {:?}", e)))?,
    };

    // E. Return Hasil
    let json_output = serde_json::to_string(&result)
        .map_err(|e| api_error(&format!("Gagal serialize output: {}", e)))?;

    Ok(JsValue::from_str(&json_output))
}

// 2. MULTICOLLINEARITY (VIF)
#[derive(serde::Deserialize)]
struct VifConfig {
    #[serde(default)]
    feature_names: Vec<String>,
    #[serde(default, alias = "categoricalVariables")]
    categorical_variables: Vec<models::config::CategoricalVarConfig>,
}

#[wasm_bindgen]
pub fn calculate_vif(
    data_x: &[f64],
    rows: usize,
    cols: usize,
    data_y: &[f64],
    config_json: String,
) -> Result<JsValue, JsValue> {
    if rows == 0 || cols == 0 {
        return Err(api_error("Data kosong untuk VIF."));
    }
    if data_y.len() != rows {
        return Err(api_error(
            "Dimensi data Y tidak sesuai dengan jumlah baris X",
        ));
    }

    let vif_config: VifConfig = serde_json::from_str(&config_json).unwrap_or(VifConfig {
        feature_names: (0..cols).map(|i| format!("Var_{}", i)).collect(),
        categorical_variables: Vec::new(),
    });

    let x_raw = DMatrix::from_row_slice(rows, cols, data_x);
    let y_vector = DVector::from_column_slice(data_y);

    // Expand categorical predictors into the same dummy-coded columns used
    // by the main regression, so VIF reflects the actual model matrix.
    let mut design_cfg = LogisticConfig::default();
    design_cfg.categorical_variables = vif_config.categorical_variables;

    let design = stats::design_matrix::build(&x_raw, &vif_config.feature_names, &design_cfg)
        .map_err(|e| api_error(&format!("Gagal membangun design matrix: {}", e)))?;

    let variable_groups: Vec<(String, Vec<usize>)> = design
        .variable_groups
        .into_iter()
        .map(|g| (g.name, g.column_indices))
        .collect();

    match stats::assumptions::calculate_vif(&design.matrix, &y_vector, &variable_groups) {
        Ok(vif_results) => {
            let json = serde_json::to_string(&vif_results)
                .map_err(|e| api_error(&format!("JSON Error: {}", e)))?;
            Ok(JsValue::from_str(&json))
        }
        Err(e) => Err(api_error(&e)),
    }
}

// 3. LINEARITY (BOX-TIDWELL)
#[derive(serde::Deserialize)]
struct BoxTidwellConfig {
    #[serde(default)]
    feature_names: Vec<String>,
    #[serde(default, alias = "categoricalVariables")]
    categorical_variables: Vec<models::config::CategoricalVarConfig>,
}

#[wasm_bindgen]
pub fn calculate_box_tidwell(
    data_x: &[f64],
    rows: usize,
    cols: usize,
    data_y: &[f64],
    config_json: String,
) -> Result<JsValue, JsValue> {
    let bt_config: BoxTidwellConfig =
        serde_json::from_str(&config_json).unwrap_or(BoxTidwellConfig {
            feature_names: (0..cols).map(|i| format!("Var_{}", i)).collect(),
            categorical_variables: Vec::new(),
        });

    let x_raw = DMatrix::from_row_slice(rows, cols, data_x);
    let y_vector = DVector::from_column_slice(data_y);

    let mut design_cfg = LogisticConfig::default();
    design_cfg.categorical_variables = bt_config.categorical_variables;

    let design = stats::design_matrix::build(&x_raw, &bt_config.feature_names, &design_cfg)
        .map_err(|e| api_error(&format!("Gagal membangun design matrix: {}", e)))?;

    let variable_groups: Vec<(String, Vec<usize>, bool)> = design
        .variable_groups
        .into_iter()
        .map(|g| (g.name, g.column_indices, g.is_categorical))
        .collect();

    match stats::assumptions::calculate_box_tidwell(&design.matrix, &y_vector, &variable_groups) {
        Ok(bt_results) => {
            let json = serde_json::to_string(&bt_results)
                .map_err(|e| api_error(&format!("JSON Error: {}", e)))?;
            Ok(JsValue::from_str(&json))
        }
        Err(e) => Err(api_error(&e)),
    }
}

// 4. BENCHMARK EKSPERIMEN 2×2 (inti IRLS tanpa nalgebra, lihat bench/irls_core.rs)
// Hanya dipakai menu "Binary Logistic (Experiment)". Hasil dikembalikan sebagai
// objek JS {beta, se, neg2ll, iterations, converged, stepHalvings, coreMs}
// lewat serde_wasm_bindgen; coreMs = durasi irls_core murni di dalam Wasm.
#[wasm_bindgen]
pub fn irls_core_bench(
    data_x: &[f64],
    n: usize,
    p: usize,
    data_y: &[f64],
    max_iter: usize,
    tol: f64,
) -> Result<JsValue, JsValue> {
    let t0 = bench::now_ms();
    let result = bench::irls_core::irls_core(data_x, data_y, n, p, max_iter, tol)
        .map_err(|e| api_error(&e))?;
    let core_ms = bench::now_ms() - t0;

    serde_wasm_bindgen::to_value(&bench::BenchOutput::new(result, core_ms))
        .map_err(|e| api_error(&format!("Gagal serialize hasil benchmark: {}", e)))
}
