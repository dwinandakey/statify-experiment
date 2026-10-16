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

export async function captureEnvironment(): Promise<EnvironmentMeta> {
  const nav = navigator as Navigator & { deviceMemory?: number };
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
  };
}
