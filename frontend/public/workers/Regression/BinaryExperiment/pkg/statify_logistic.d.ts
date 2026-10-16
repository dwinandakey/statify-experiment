/* tslint:disable */
/* eslint-disable */

export function calculate_binary_logistic(data_x: Float64Array, rows: number, cols: number, data_y: Float64Array, config_json: string, feature_names_json: string): any;

/**
 * Sama dengan `calculate_binary_logistic` produksi untuk metode Enter (string
 * JSON identik), ditambah pencatatan waktu di dalam Wasm. Waktunya dibaca
 * setelah timer JavaScript berhenti lewat `last_full_timings()`, supaya
 * jalur kembali panggilan yang diukur tetap sama (satu string JSON).
 */
export function calculate_binary_logistic_timed(data_x: Float64Array, rows: number, cols: number, data_y: Float64Array, config_json: string, feature_names_json: string): any;

export function calculate_box_tidwell(data_x: Float64Array, rows: number, cols: number, data_y: Float64Array, config_json: string): any;

export function calculate_vif(data_x: Float64Array, rows: number, cols: number, data_y: Float64Array, config_json: string): any;

export function irls_core_bench(data_x: Float64Array, n: number, p: number, data_y: Float64Array, max_iter: number, tol: number): any;

/**
 * `[analysisMs, serializeMs]` dari panggilan `calculate_binary_logistic_timed`
 * terakhir (NaN bila gagal atau di luar wasm32).
 */
export function last_full_timings(): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly calculate_binary_logistic: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly calculate_binary_logistic_timed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly calculate_box_tidwell: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly calculate_vif: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly irls_core_bench: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly last_full_timings: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
