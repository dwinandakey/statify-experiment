/**
 * Instrumentasi pengukuran eksperimen: monitor frame (rAF), long task,
 * memori, statistik ringkas, dan metadata lingkungan.
 */
import type { EnvironmentMeta, SummaryStats } from "../types/experiment";

/** Interval frame nominal 60 Hz; cadangan bila interval refresh tidak bisa diukur. */
export const NOMINAL_FRAME_MS = 1000 / 60;

/** Interval refresh terukur yang masuk akal (4–50 ms); selain itu nominal 60 Hz. */
export function sanitizeFrameInterval(ms: number | null | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 4 && ms <= 50 ? ms : NOMINAL_FRAME_MS;
}

export interface FrameStats {
  maxFrameGapMs: number;
  /** Perkiraan frame yang terlewat: Σ max(0, round(gap / T) − 1). Gap 255 ms pada 60 Hz → 14. */
  droppedFrames: number;
  /** Jumlah gap > 2T (jumlah gap, bukan jumlah frame; definisi droppedFrames versi awal). */
  longGapCount: number;
  frameCount: number;
  /** T: interval refresh yang dipakai untuk droppedFrames dan longGapCount. */
  frameIntervalMs: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Frame rAF berikutnya. Di tab tersembunyi rAF berhenti total, jadi dibatasi
 * timeout agar batch tidak menggantung (resolve null bila timeout).
 */
export function nextFrame(timeoutMs = 250): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    requestAnimationFrame((ts) => {
      clearTimeout(timer);
      resolve(ts);
    });
  });
}

/**
 * Task baru (lewat MessageChannel, tanpa clamp setTimeout). Dipakai agar
 * dispatch tidak terjadi di dalam callback rAF: kalau di sana, hasil worker
 * selalu menunggu fase render frame tersebut selesai (overhead sistematis),
 * padahal di aplikasi nyata komputasi dipicu dari task biasa (mis. klik).
 */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Jeda antar run: dua frame rAF + setTimeout 50 ms (UI sempat render, rAF berikutnya bersih). */
export async function interRunPause(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await sleep(50);
}

/**
 * Mencatat waktu setiap callback requestAnimationFrame selama run.
 * start() resolve pada frame pertama (baseline); stop() menunggu SATU frame
 * lagi agar gap yang memuat blocking main thread ikut tercatat.
 * Jika tab tersembunyi (rAF tidak jalan), keduanya jatuh ke timeout.
 *
 * Yang dicatat adalah performance.now() saat callback BERJALAN, bukan argumen
 * timestamp rAF. Di Chromium argumen itu adalah waktu BeginFrame (selaras
 * vsync), yang bisa jauh lebih awal dari saat callback sempat dijalankan bila
 * main thread macet. Akibatnya gap terkuantisasi ke kelipatan 16,7 ms dan
 * meremehkan freeze (teramati: inti 62 ms → gap timestamp 50,0 ms).
 */
export class FrameMonitor {
  /** T untuk droppedFrames; diisi sesi dari interval refresh terukur. */
  frameIntervalMs = NOMINAL_FRAME_MS;
  private stamps: number[] = [];
  private handle: number | null = null;
  private running = false;
  private onNextFrame: (() => void) | null = null;

  start(timeoutMs = 1000): Promise<void> {
    this.cancel();
    this.stamps = [];
    this.running = true;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const tick = () => {
        if (!this.running) return;
        this.stamps.push(performance.now());
        if (this.stamps.length === 1) {
          clearTimeout(timer);
          resolve();
        }
        if (this.onNextFrame) {
          const done = this.onNextFrame;
          this.onNextFrame = null;
          done();
          return;
        }
        this.handle = requestAnimationFrame(tick);
      };
      this.handle = requestAnimationFrame(tick);
    });
  }

  stop(timeoutMs = 1000): Promise<FrameStats> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.cancel();
        resolve(computeFrameStats(this.stamps, this.frameIntervalMs));
      };
      const timer = setTimeout(() => {
        this.onNextFrame = null;
        finish();
      }, timeoutMs);
      this.onNextFrame = finish;
    });
  }

  cancel(): void {
    this.running = false;
    this.onNextFrame = null;
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  /** Salinan stempel rAF jendela terakhir (start() → stop()), untuk metrik fase frame. */
  stampsSnapshot(): number[] {
    return [...this.stamps];
  }
}

export interface FramePhases {
  /** t0 − callback rAF terakhir ≤ t0. */
  t0PhaseMs: number | null;
  /** t1 − callback rAF terakhir ≤ t1. */
  t1PhaseMs: number | null;
  /** callback rAF pertama > t1, dikurangi t1. */
  nextFrameAfterT1Ms: number | null;
}

/**
 * Fase dispatch dan hasil relatif terhadap frame, dari stempel yang sudah dicatat
 * FrameMonitor (jam main thread yang sama dengan t0/t1). Metrik frame lain tidak berubah.
 */
export function computeFramePhases(stamps: number[], t0: number, t1: number): FramePhases {
  let lastAtT0: number | null = null;
  let lastAtT1: number | null = null;
  let firstAfterT1: number | null = null;
  for (const s of stamps) {
    if (s <= t0) lastAtT0 = s;
    if (s <= t1) lastAtT1 = s;
    else if (firstAfterT1 === null) firstAfterT1 = s;
  }
  return {
    t0PhaseMs: lastAtT0 === null ? null : t0 - lastAtT0,
    t1PhaseMs: lastAtT1 === null ? null : t1 - lastAtT1,
    nextFrameAfterT1Ms: firstAfterT1 === null ? null : firstAfterT1 - t1,
  };
}

export interface WorkerLatencies {
  dispatchLatencyMs: number;
  returnLatencyMs: number;
  workerHandlerMs: number;
  clockCheckFailed: boolean;
}

/** Ambang cek jam: latensi < −0,05 ms berarti jam main thread dan worker tidak konsisten. */
export const CLOCK_CHECK_TOLERANCE_MS = -0.05;

/**
 * Rincian overheadMs mode worker. Stempel worker (tRecv di baris pertama handler pesan run,
 * tPost tepat sebelum postMessage hasil) dan t0/t1 main thread dinyatakan dalam epoch
 * performance.timeOrigin + now() masing-masing konteks.
 */
export function workerLatencies(
  t0: number,
  t1: number,
  epochs: { recvEpochMs: number; postEpochMs: number } | null | undefined,
  timeOrigin: number
): WorkerLatencies | null {
  if (!epochs) return null;
  const dispatchLatencyMs = epochs.recvEpochMs - (timeOrigin + t0);
  const returnLatencyMs = timeOrigin + t1 - epochs.postEpochMs;
  const workerHandlerMs = epochs.postEpochMs - epochs.recvEpochMs;
  return {
    dispatchLatencyMs,
    returnLatencyMs,
    workerHandlerMs,
    clockCheckFailed: [dispatchLatencyMs, returnLatencyMs, workerHandlerMs].some((v) => v < CLOCK_CHECK_TOLERANCE_MS),
  };
}

export function computeFrameStats(stamps: number[], frameIntervalMs = NOMINAL_FRAME_MS): FrameStats {
  let maxGap = 0;
  let dropped = 0;
  let longGaps = 0;
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i] - stamps[i - 1];
    if (gap > maxGap) maxGap = gap;
    // Frame yang seharusnya tampil di antara dua callback rAF tetapi terlewat
    dropped += Math.max(0, Math.round(gap / frameIntervalMs) - 1);
    if (gap > 2 * frameIntervalMs) longGaps++;
  }
  return {
    maxFrameGapMs: stamps.length > 1 ? maxGap : NaN,
    droppedFrames: dropped,
    longGapCount: longGaps,
    frameCount: stamps.length,
    frameIntervalMs,
  };
}

/**
 * Mengumpulkan entri PerformanceObserver "longtask" (Chromium) dan
 * menghitung yang tumpang-tindih dengan jendela run. Entri dikirim browser
 * secara asinkron, jadi collect() dipanggil setelah jeda antar run dan
 * memakai takeRecords() untuk mengambil entri yang belum terkirim.
 */
export class LongTaskCollector {
  readonly supported: boolean;
  private observer: PerformanceObserver | null = null;
  private entries: { start: number; end: number }[] = [];

  constructor() {
    this.supported =
      typeof PerformanceObserver !== "undefined" &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes("longtask");
  }

  start(): void {
    if (!this.supported || this.observer) return;
    this.entries = [];
    this.observer = new PerformanceObserver((list) => this.push(list.getEntries()));
    this.observer.observe({ type: "longtask", buffered: false });
  }

  collect(windowStart: number, windowEnd: number): { count: number; totalMs: number } | null {
    if (!this.observer) return null;
    this.push(this.observer.takeRecords());
    let count = 0;
    let totalMs = 0;
    for (const e of this.entries) {
      if (e.start < windowEnd && e.end > windowStart) {
        count++;
        totalMs += e.end - e.start;
      }
    }
    // Entri yang sudah lewat jendela ini tidak dibutuhkan run berikutnya
    this.entries = this.entries.filter((e) => e.end > windowEnd);
    return { count, totalMs };
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.entries = [];
  }

  private push(list: PerformanceEntryList): void {
    for (const e of list) this.entries.push({ start: e.startTime, end: e.startTime + e.duration });
  }
}

const MB = 1024 * 1024;

/**
 * performance.memory.usedJSHeapSize main thread (non-standar, Chromium); null
 * bila tidak ada. Tidak tersedia di worker, jadi heap worker tidak terukur.
 */
export function mainHeapUsedMB(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return mem && typeof mem.usedJSHeapSize === "number" ? mem.usedJSHeapSize / MB : null;
}

export function bytesToMB(bytes: number | null | undefined): number | null {
  return typeof bytes === "number" ? bytes / MB : null;
}

// --- Statistik ringkas ---

/** Kuantil tipe 7 (interpolasi linear; default R dan NumPy). `sorted` harus terurut naik. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summarize(values: number[]): SummaryStats | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q1 = quantile(v, 0.25);
  const q3 = quantile(v, 0.75);
  return {
    count: v.length,
    median: quantile(v, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    min: v[0],
    max: v[v.length - 1],
  };
}

// --- Lingkungan ---

/** Median interval rAF selama `frames` frame saat idle (≈ 16,7 ms pada layar 60 Hz). */
export async function estimateRefreshInterval(frames = 30): Promise<number | null> {
  if (typeof requestAnimationFrame === "undefined") return null;
  const stamps: number[] = [];
  const deadline = performance.now() + 2000;
  while (stamps.length < frames + 1 && performance.now() < deadline) {
    const ts = await nextFrame();
    if (ts === null) break;
    stamps.push(ts);
  }
  if (stamps.length < 3) return null;
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
  return quantile(gaps, 0.5);
}

/** Selisih positif terkecil antar pembacaan performance.now() (resolusi efektif timer). */
export function estimateTimerResolution(sampleMs = 5): number | null {
  const end = performance.now() + sampleMs;
  let prev = performance.now();
  let min = Infinity;
  while (prev < end) {
    const t = performance.now();
    if (t > prev && t - prev < min) min = t - prev;
    prev = t;
  }
  return Number.isFinite(min) ? min : null;
}

// --- Browser, artefak, dan perangkat (eksperimen v2) ---

export const ARTIFACT_HASHES_URL = "/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json";
export const WASM_BINARY_URL = "/workers/Regression/BinaryExperiment/pkg/statify_logistic_bg.wasm";
const WASM_MANIFEST_KEY = "pkg/statify_logistic_bg.wasm";

type UaHighEntropy = NonNullable<EnvironmentMeta["uaHighEntropy"]>;

/**
 * Nama dan versi lengkap browser. Chromium: brand di fullVersionList (UA Chrome direduksi menjadi
 * "Chrome/155.0.0.0"); Firefox dan lainnya: dari UA. Fungsi murni, diuji tanpa browser.
 */
export function detectBrowser(userAgent: string, uaHighEntropy: UaHighEntropy | null): { name: string; version: string | null } {
  const brands = uaHighEntropy?.fullVersionList ?? [];
  for (const [brand, name] of [
    ["Microsoft Edge", "edge"],
    ["Google Chrome", "chrome"],
    ["Chromium", "chromium"],
  ] as const) {
    const hit = brands.find((b) => b.brand === brand);
    if (hit) return { name, version: hit.version };
  }
  const firefox = /Firefox\/(\d+(?:\.\d+)*)/.exec(userAgent);
  if (firefox) return { name: "firefox", version: firefox[1] };
  const edge = /Edg\/(\d+(?:\.\d+)*)/.exec(userAgent);
  if (edge) return { name: "edge", version: edge[1] };
  const chrome = /Chrome\/(\d+(?:\.\d+)*)/.exec(userAgent);
  if (chrome) return { name: "chrome", version: chrome[1] };
  return { name: "unknown", version: null };
}

/** navigator.userAgentData.getHighEntropyValues (hanya Chromium); null di Firefox atau bila gagal. */
async function uaHighEntropyValues(): Promise<UaHighEntropy | null> {
  const uaData = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<UaHighEntropy> } })
    .userAgentData;
  if (!uaData || typeof uaData.getHighEntropyValues !== "function") return null;
  try {
    const v = await uaData.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness"]);
    return { fullVersionList: v.fullVersionList, platformVersion: v.platformVersion, architecture: v.architecture, bitness: v.bitness };
  } catch {
    return null;
  }
}

/** navigator.getBattery (Chromium); null bila tidak ada atau ditolak. */
async function batteryStatus(): Promise<EnvironmentMeta["battery"]> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }).getBattery;
  if (typeof getBattery !== "function") return null;
  try {
    const b = await getBattery.call(navigator);
    return { charging: b.charging, level: b.level };
  } catch {
    return null;
  }
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 (hex) lewat crypto.subtle; null bila tidak tersedia (konteks tidak aman). */
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  return toHex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** ARTIFACT_HASHES.json build ini, lalu verifikasi .wasm yang disajikan dengan SHA-256 di runtime. */
async function artifactCheck(): Promise<Pick<EnvironmentMeta, "artifactHashes" | "wasmSha256Runtime" | "wasmHashVerified">> {
  let artifactHashes: EnvironmentMeta["artifactHashes"] = null;
  let wasmSha256Runtime: string | null = null;
  try {
    const res = await fetch(ARTIFACT_HASHES_URL, { cache: "no-store" });
    if (res.ok) artifactHashes = ((await res.json()) as { files?: EnvironmentMeta["artifactHashes"] }).files ?? null;
  } catch {
    artifactHashes = null;
  }
  try {
    const res = await fetch(WASM_BINARY_URL);
    if (res.ok) wasmSha256Runtime = await sha256Hex(await res.arrayBuffer());
  } catch {
    wasmSha256Runtime = null;
  }
  const expected = artifactHashes?.[WASM_MANIFEST_KEY]?.sha256;
  return {
    artifactHashes,
    wasmSha256Runtime,
    wasmHashVerified: expected && wasmSha256Runtime ? expected === wasmSha256Runtime : null,
  };
}

export async function captureEnvironment(): Promise<EnvironmentMeta> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const uaHighEntropy = await uaHighEntropyValues();
  const browser = detectBrowser(nav.userAgent, uaHighEntropy);
  return {
    userAgent: nav.userAgent,
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    buildMode: process.env.NODE_ENV ?? "unknown",
    gitCommit: process.env.NEXT_PUBLIC_GIT_COMMIT || null,
    refreshIntervalMs: await estimateRefreshInterval(),
    timerResolutionMs: estimateTimerResolution(),
    longTaskSupported: new LongTaskCollector().supported,
    memoryApiSupported: mainHeapUsedMB() !== null,
    capturedAt: new Date().toISOString(),
    browserName: browser.name,
    browserVersion: browser.version,
    uaHighEntropy,
    webdriver: typeof nav.webdriver === "boolean" ? nav.webdriver : null,
    hasFocusStart: typeof document !== "undefined" ? document.hasFocus() : null,
    visibilityStart: typeof document !== "undefined" ? document.visibilityState : null,
    hasFocusEnd: null,
    visibilityEnd: null,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : null,
    innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
    innerHeight: typeof window !== "undefined" ? window.innerHeight : null,
    battery: await batteryStatus(),
    // Diisi captureEnvironmentEnd setelah pengukuran (lihat di sana)
    artifactHashes: null,
    wasmSha256Runtime: null,
    wasmHashVerified: null,
  };
}

/**
 * Akhir batch: hasFocus/visibilityState akhir, lalu ARTIFACT_HASHES.json dan SHA-256 .wasm yang
 * disajikan. Fetch .wasm sengaja SETELAH semua run: di halaman baru, fetch pertama sebelum
 * preload akan membuat init() hanya merevalidasi cache HTTP sehingga mainWasmInitMs (fetch +
 * compile + instantiate, sekali per page load) tidak lagi sama definisinya dengan v1.
 */
export async function captureEnvironmentEnd(env: EnvironmentMeta): Promise<void> {
  env.hasFocusEnd = typeof document !== "undefined" ? document.hasFocus() : null;
  env.visibilityEnd = typeof document !== "undefined" ? document.visibilityState : null;
  Object.assign(env, await artifactCheck());
}
