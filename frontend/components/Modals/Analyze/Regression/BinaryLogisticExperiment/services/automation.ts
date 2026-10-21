/**
 * Integrasi orkestrator sesi (eksperimen v2, tests/experiment/orchestrate.mjs).
 *
 * - Info sesi dari query URL: expSession (id), expSessionIndex, expRole (pilot|measure),
 *   expBrowser. Disimpan ke meta.session dan kolom CSV sessionId/sessionIndex/sessionRole.
 * - Hook window.__blExp, HANYA aktif bila URL halaman berisi expAutomation=1:
 *   getBatchOutputs(), clearBatchOutputs(), waitForBatchOutputs(count), exportDesign(N).
 *   Tanpa parameter itu tidak ada yang dipasang di window dan tidak ada output batch yang disimpan.
 */
import type { SessionInfo, Workload } from "../types/experiment";
import { sha256Hex } from "./metrics";

const currentSearch = () => (typeof window === "undefined" ? "" : window.location.search);

/** Info sesi dari query string; null bila tidak ada satu pun parameter sesi. */
export function parseSessionInfo(search: string): SessionInfo | null {
  const q = new URLSearchParams(search);
  const id = q.get("expSession");
  const index = q.get("expSessionIndex");
  const role = q.get("expRole");
  const browser = q.get("expBrowser");
  if (id === null && index === null && role === null && browser === null) return null;
  return {
    id,
    index: index !== null && /^\d+$/.test(index) ? Number(index) : null,
    role: role === "pilot" || role === "measure" ? role : null,
    browser,
  };
}

export function readSessionInfo(): SessionInfo | null {
  return parseSessionInfo(currentSearch());
}

export function automationEnabled(search: string = currentSearch()): boolean {
  return new URLSearchParams(search).get("expAutomation") === "1";
}

// --- Output batch untuk orkestrator ---

export interface BatchOutput {
  batchId: string;
  workload: Workload;
  status: string;
  /** Isi yang sama dengan tombol Download CSV / meta.json. */
  csv: string;
  metaJson: string;
}

const batchOutputs: BatchOutput[] = [];
const outputWaiters: { count: number; resolve: (n: number) => void }[] = [];

/** Simpan output batch yang selesai (apa pun statusnya); no-op tanpa expAutomation=1. */
export function recordBatchOutput(output: BatchOutput): void {
  if (!automationEnabled()) return;
  batchOutputs.push(output);
  for (let i = outputWaiters.length - 1; i >= 0; i--) {
    if (batchOutputs.length >= outputWaiters[i].count) outputWaiters.splice(i, 1)[0].resolve(batchOutputs.length);
  }
}

/**
 * Promise yang selesai saat jumlah output batch ≥ count. Tanpa polling: orkestrator menunggu
 * batch lewat satu evaluate yang menggantung, sehingga tidak ada kerja tambahan di main thread
 * (rAF/MutationObserver) selama jendela ukur.
 */
function waitForBatchOutputs(count: number): Promise<number> {
  if (batchOutputs.length >= count) return Promise.resolve(batchOutputs.length);
  return new Promise((resolve) => outputWaiters.push({ count, resolve }));
}

// --- Ekspor design matrix (baseline native) ---

export interface DesignExport {
  /** Design matrix workload core, Float64 little-endian, row-major n × p, base64. */
  X_b64: string;
  /** y 0/1, Float64 little-endian, base64. */
  y_b64: string;
  n: number;
  p: number;
  featureNames: string[];
  /** SHA-256 (hex) byte X dan byte y di atas (sebelum base64). */
  sha256: { X: string; y: string };
}

/** Byte Float64 little-endian (eksplisit, tidak bergantung endianness platform). */
export function float64LE(values: Float64Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i], true);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // String.fromCharCode per potongan: aman untuk array besar
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function encodeDesign(X: Float64Array, y: Float64Array, n: number, p: number, featureNames: string[]): Promise<DesignExport> {
  const xBytes = float64LE(X);
  const yBytes = float64LE(y);
  return {
    X_b64: bytesToBase64(xBytes),
    y_b64: bytesToBase64(yBytes),
    n,
    p,
    featureNames: [...featureNames],
    sha256: { X: (await sha256Hex(xBytes)) ?? "", y: (await sha256Hex(yBytes)) ?? "" },
  };
}

// --- Hook window.__blExp ---

type DesignProvider = (N: number) => Promise<DesignExport>;
let designProvider: DesignProvider | null = null;

interface AutomationHook {
  version: 1;
  getBatchOutputs(): BatchOutput[];
  clearBatchOutputs(): void;
  /** Selesai saat getBatchOutputs().length ≥ count (event-driven, tanpa polling). */
  waitForBatchOutputs(count: number): Promise<number>;
  exportDesign(N: number): Promise<DesignExport>;
}

/**
 * Pasang window.__blExp (sekali per halaman) dan daftarkan penyedia design matrix dialog yang
 * sedang terbuka. Mengembalikan fungsi pelepas penyedia (dipanggil saat dialog di-unmount);
 * output batch yang sudah tersimpan tetap bisa dibaca setelah dialog ditutup.
 */
export function installAutomationHook(provider: DesignProvider): () => void {
  if (typeof window === "undefined" || !automationEnabled()) return () => undefined;
  designProvider = provider;
  const w = window as Window & { __blExp?: AutomationHook };
  if (!w.__blExp) {
    w.__blExp = {
      version: 1,
      getBatchOutputs: () => batchOutputs.map((o) => ({ ...o })),
      clearBatchOutputs: () => {
        batchOutputs.length = 0;
      },
      waitForBatchOutputs,
      exportDesign: (N: number) => {
        if (!designProvider) return Promise.reject(new Error("Open the Binary Logistic (Experiment) dialog first."));
        return designProvider(N);
      },
    };
  }
  return () => {
    if (designProvider === provider) designProvider = null;
  };
}
