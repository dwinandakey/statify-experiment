//! Modul benchmark eksperimen 2×2 (JavaScript vs Rust-Wasm × main thread vs
//! Web Worker). Tidak dipakai oleh analisis produksi; hanya diekspor lewat
//! `irls_core_bench` di lib.rs dan dibangun ke
//! public/workers/Regression/BinaryExperiment/pkg (npm run build:wasm:experiment).

pub mod irls_core;

use serde::Serialize;

/// Bentuk objek yang dikembalikan `irls_core_bench` ke JavaScript.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchOutput {
    pub beta: Vec<f64>,
    pub se: Vec<f64>,
    pub neg2ll: f64,
    pub iterations: u32,
    pub converged: bool,
    pub step_halvings: u32,
    /// Durasi `irls_core` murni di dalam Wasm (ms, via performance.now()),
    /// tanpa penyalinan input ke memori linear dan tanpa serialisasi hasil.
    /// NaN di luar wasm32 (cargo test).
    pub core_ms: f64,
}

impl BenchOutput {
    pub fn new(r: irls_core::IrlsCoreResult, core_ms: f64) -> Self {
        Self {
            beta: r.beta,
            se: r.se,
            neg2ll: r.neg2ll,
            iterations: r.iterations,
            converged: r.converged,
            step_halvings: r.step_halvings,
            core_ms,
        }
    }
}

/// `performance.now()` dari global JS (ada di window maupun worker).
#[cfg(target_arch = "wasm32")]
mod clock {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = performance, js_name = now)]
        fn performance_now() -> f64;
    }

    pub fn now_ms() -> f64 {
        performance_now()
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod clock {
    /// Di luar wasm32 tidak ada performance.now().
    pub fn now_ms() -> f64 {
        f64::NAN
    }
}

pub use clock::now_ms;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nama_field_output_sesuai_kontrak_js() {
        let r = irls_core::IrlsCoreResult {
            beta: vec![0.1, 0.2],
            se: vec![0.3, 0.4],
            neg2ll: 12.5,
            iterations: 4,
            converged: true,
            step_halvings: 0,
        };
        let v = serde_json::to_value(BenchOutput::new(r, 1.5)).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["beta", "converged", "coreMs", "iterations", "neg2ll", "se", "stepHalvings"]
        );
    }
}
