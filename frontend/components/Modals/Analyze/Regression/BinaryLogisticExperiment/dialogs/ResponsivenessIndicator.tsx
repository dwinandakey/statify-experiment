"use client";

import React, { useEffect, useRef } from "react";
import { Activity } from "lucide-react";

/**
 * Indikator responsivitas main thread: bar bolak-balik dan penghitung FPS
 * yang digerakkan requestAnimationFrame. SENGAJA bukan animasi CSS, karena
 * animasi transform CSS tetap berjalan di compositor walau main thread macet.
 * Saat inti dijalankan di main thread (mode A/C) dengan N besar, bar berhenti
 * dan FPS jatuh, jadi freeze terlihat dan bisa direkam untuk demo.
 *
 * DOM diperbarui langsung lewat ref (tanpa setState) agar tidak memicu render React.
 */
const PERIOD_MS = 1600;
const GAP_WINDOW_MS = 5000;

export function ResponsivenessIndicator({ active }: { active: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const gapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frames: number[] = [];
    const gaps: { at: number; gap: number }[] = [];
    let last = 0;
    let lastText = 0;
    let handle = requestAnimationFrame(function tick(ts: number) {
      // Gap diukur dengan waktu callback berjalan (lihat FrameMonitor), posisi bar dengan ts
      const now = performance.now();
      if (last > 0) gaps.push({ at: now, gap: now - last });
      last = now;
      frames.push(now);
      while (frames.length > 0 && frames[0] <= now - 1000) frames.shift();
      while (gaps.length > 0 && gaps[0].at <= now - GAP_WINDOW_MS) gaps.shift();

      const track = trackRef.current;
      const bar = barRef.current;
      if (track && bar && !reduceMotion) {
        const travel = Math.max(0, track.clientWidth - bar.clientWidth);
        const phase = (ts % PERIOD_MS) / PERIOD_MS;
        const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        bar.style.transform = `translateX(${(tri * travel).toFixed(1)}px)`;
      }
      if (now - lastText > 200) {
        lastText = now;
        if (fpsRef.current) fpsRef.current.textContent = String(frames.length);
        if (gapRef.current) {
          const worst = gaps.reduce((m, g) => Math.max(m, g.gap), 0);
          gapRef.current.textContent = worst > 0 ? worst.toFixed(0) : "–";
        }
      }
      handle = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(handle);
  }, [active]);

  return (
    <div
      className="rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="bl-exp-responsiveness"
      aria-label="Main-thread responsiveness indicator"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Main thread
        </span>
        <span className="tabular-nums">
          <span ref={fpsRef} className="font-semibold text-foreground">
            –
          </span>{" "}
          fps · max frame gap (5 s){" "}
          <span ref={gapRef} className="font-semibold text-foreground">
            –
          </span>{" "}
          ms
        </span>
      </div>
      <div ref={trackRef} className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="absolute left-0 top-0 h-2 w-10 rounded-full bg-primary will-change-transform" />
      </div>
    </div>
  );
}
