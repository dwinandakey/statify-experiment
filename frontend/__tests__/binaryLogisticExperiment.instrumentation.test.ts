/**
 * @jest-environment node
 *
 * Instrumentasi eksperimen v2 (fungsi murni): fase frame, rincian latensi worker dan cek jam,
 * deteksi browser, info sesi dari query URL, dan ekspor design matrix (Float64 LE + SHA-256).
 * Lingkungan node: crypto.subtle dan btoa tersedia seperti di browser.
 */
import { createHash } from "node:crypto";
import {
  CLOCK_CHECK_TOLERANCE_MS,
  computeFrameStats,
  computeFramePhases,
  detectBrowser,
  workerLatencies,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/metrics";
import {
  automationEnabled,
  bytesToBase64,
  encodeDesign,
  float64LE,
  parseSessionInfo,
} from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/automation";

describe("computeFramePhases (dari stempel FrameMonitor)", () => {
  const stamps = [0, 16.7, 33.4, 100, 116.7];

  test("t0/t1 relatif terhadap callback rAF terakhir, frame berikutnya setelah t1", () => {
    const p = computeFramePhases(stamps, 20, 90);
    expect(p.t0PhaseMs).toBeCloseTo(3.3, 10);
    expect(p.t1PhaseMs).toBeCloseTo(56.6, 10);
    expect(p.nextFrameAfterT1Ms).toBeCloseTo(10, 10);
  });

  test("stempel tepat di t0/t1 dihitung sebagai ≤; tanpa stempel → null", () => {
    expect(computeFramePhases(stamps, 16.7, 116.7)).toEqual({ t0PhaseMs: 0, t1PhaseMs: 0, nextFrameAfterT1Ms: null });
    expect(computeFramePhases([], 1, 2)).toEqual({ t0PhaseMs: null, t1PhaseMs: null, nextFrameAfterT1Ms: null });
    expect(computeFramePhases([50], 10, 20)).toEqual({ t0PhaseMs: null, t1PhaseMs: null, nextFrameAfterT1Ms: 30 });
  });

  test("definisi metrik frame lama tidak berubah", () => {
    expect(computeFrameStats(stamps, 16.7)).toEqual({
      maxFrameGapMs: 66.6,
      droppedFrames: 3,
      longGapCount: 1,
      frameCount: 5,
      frameIntervalMs: 16.7,
    });
  });
});

describe("workerLatencies (stempel epoch main thread dan worker)", () => {
  const origin = 1_760_000_000_000;

  test("dispatch = tRecv − t0, return = t1 − tPost, handler = tPost − tRecv", () => {
    const l = workerLatencies(1000, 1010, { recvEpochMs: origin + 1001, postEpochMs: origin + 1008 }, origin)!;
    expect(l.dispatchLatencyMs).toBeCloseTo(1, 6);
    expect(l.returnLatencyMs).toBeCloseTo(2, 6);
    expect(l.workerHandlerMs).toBeCloseTo(7, 6);
    expect(l.clockCheckFailed).toBe(false);
  });

  test("nilai < −0,05 ms menandai clockCheckFailed; tanpa stempel (mode main) → null", () => {
    expect(CLOCK_CHECK_TOLERANCE_MS).toBe(-0.05);
    expect(workerLatencies(1000, 1010, { recvEpochMs: origin + 999.9, postEpochMs: origin + 1008 }, origin)!.clockCheckFailed).toBe(true);
    expect(workerLatencies(1000, 1010, { recvEpochMs: origin + 999.96, postEpochMs: origin + 1008 }, origin)!.clockCheckFailed).toBe(false);
    expect(workerLatencies(1000, 1010, null, origin)).toBeNull();
  });
});

describe("detectBrowser", () => {
  const chromeUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

  test("Chromium: versi lengkap dari fullVersionList (UA direduksi)", () => {
    const list = [
      { brand: "Not)A;Brand", version: "99.0.0.0" },
      { brand: "Google Chrome", version: "155.0.8059.80" },
      { brand: "Chromium", version: "155.0.8059.80" },
    ];
    expect(detectBrowser(chromeUa, { fullVersionList: list })).toEqual({ name: "chrome", version: "155.0.8059.80" });
    expect(detectBrowser(chromeUa, { fullVersionList: [{ brand: "Microsoft Edge", version: "141.0.3537.71" }, ...list] })).toEqual({
      name: "edge",
      version: "141.0.3537.71",
    });
    // Tanpa userAgentData: jatuh ke UA (versi tereduksi)
    expect(detectBrowser(chromeUa, null)).toEqual({ name: "chrome", version: "155.0.0.0" });
  });

  test("Firefox: dari UA; userAgentData tidak ada (null)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0";
    expect(detectBrowser(ua, null)).toEqual({ name: "firefox", version: "158.0" });
    expect(detectBrowser("curl/8", null)).toEqual({ name: "unknown", version: null });
  });
});

describe("info sesi dan flag otomasi dari query URL", () => {
  test("parameter sesi orkestrator", () => {
    expect(parseSessionInfo("?expAutomation=1&expSession=firefox-03&expSessionIndex=7&expRole=measure&expBrowser=firefox")).toEqual({
      id: "firefox-03",
      index: 7,
      role: "measure",
      browser: "firefox",
    });
    expect(parseSessionInfo("?expSession=pilot-chrome&expRole=pilot")).toEqual({ id: "pilot-chrome", index: null, role: "pilot", browser: null });
    expect(parseSessionInfo("?expRole=other&expSessionIndex=x")).toMatchObject({ role: null, index: null });
    expect(parseSessionInfo("")).toBeNull();
  });

  test("hook hanya dengan expAutomation=1", () => {
    expect(automationEnabled("?expAutomation=1")).toBe(true);
    expect(automationEnabled("?expAutomation=0")).toBe(false);
    expect(automationEnabled("?expSession=a")).toBe(false);
    expect(automationEnabled("")).toBe(false);
  });
});

describe("ekspor design matrix", () => {
  test("Float64 little-endian, base64, SHA-256 atas byte yang sama", async () => {
    const X = Float64Array.from([1, 2.5, -0, 1e-300, 1, 3.25]);
    const y = Float64Array.from([0, 1]);
    const d = await encodeDesign(X, y, 2, 3, ["Constant", "a", "b"]);
    const xBytes = Buffer.from(d.X_b64, "base64");
    expect(Array.from(new Float64Array(xBytes.buffer, xBytes.byteOffset, 6))).toEqual(Array.from(X));
    expect(xBytes.readDoubleLE(8)).toBe(2.5);
    expect(d.sha256.X).toBe(createHash("sha256").update(xBytes).digest("hex"));
    expect(d.sha256.y).toBe(createHash("sha256").update(Buffer.from(d.y_b64, "base64")).digest("hex"));
    expect([d.n, d.p, d.featureNames]).toEqual([2, 3, ["Constant", "a", "b"]]);
  });

  test("base64 per potongan sama dengan Buffer untuk array besar", () => {
    const values = Float64Array.from({ length: 20_000 }, (_, i) => i / 7);
    const bytes = float64LE(values);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
