#!/usr/bin/env python3
"""Figures for the SAUCIS manuscript (after analyze.py): Figure 1 figures/fig_e2e_ratio.pdf,
Figure 2 figures/fig_lifecycle.pdf, supplementary figures/extra/*.

Encoding: hue = execution technology (JS orange, Wasm blue, validated pair),
line style / marker fill = location (main thread solid + filled, worker dashed + open).
"""
import os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # paths are relative to reproducibility/
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import os

os.makedirs("figures", exist_ok=True)
os.makedirs("figures/extra", exist_ok=True)

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["Times New Roman", "Nimbus Roman", "TeX Gyre Termes", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8.5, "axes.labelsize": 8.5, "axes.titlesize": 9, "legend.fontsize": 7.5,
    "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "#52514e", "axes.labelcolor": "#0b0b0b", "xtick.color": "#52514e", "ytick.color": "#52514e",
    "axes.grid": True, "grid.color": "#d9d8d4", "grid.linewidth": 0.5, "grid.alpha": 1.0,
    "lines.linewidth": 1.4, "savefig.dpi": 300, "savefig.bbox": "tight", "pdf.fonttype": 42,
})
JS, WA = "#eb6834", "#2a78d6"
INK2 = "#52514e"
STYLE = {
    "A": dict(color=JS, ls="-", marker="o", mfc=JS, label="A  JS, main thread"),
    "B": dict(color=JS, ls="--", marker="o", mfc="white", label="B  JS, Web Worker"),
    "C": dict(color=WA, ls="-", marker="s", mfc=WA, label="C  Wasm, main thread"),
    "D": dict(color=WA, ls="--", marker="s", mfc="white", label="D  Wasm, Web Worker"),
}
NS = np.array([1470, 10000, 50000, 100000])
DODGE = {"A": 0.93, "B": 0.977, "C": 1.023, "D": 1.07}

summ = pd.read_csv("analysis/out/summary_cells.csv")

# Reported ratios (Table 3 of the manuscript)
RATIO = {
    "core": {"CA": [(0.78, 0.77, 0.82), (0.75, 0.75, 0.76), (0.72, 0.71, 0.73), (0.72, 0.71, 0.72)],
             "DB": [(0.77, 0.71, 0.81), (0.85, 0.83, 0.88), (0.77, 0.76, 0.78), (0.75, 0.75, 0.76)]},
    "full": {"CA": [(0.45, 0.45, 0.46), (0.88, 0.87, 0.89), (1.03, 1.02, 1.04), (1.04, 1.04, 1.05)],
             "DB": [(0.51, 0.50, 0.53), (0.91, 0.89, 0.92), (1.07, 1.06, 1.07), (1.08, 1.07, 1.09)]},
}


def fmt_n(ax):
    ax.set_xscale("log")
    ax.set_xticks(NS)
    ax.set_xticklabels(["1,470", "10,000", "50,000", "100,000"])
    ax.minorticks_off()
    ax.set_xlim(1100, 135000)


fig, axes = plt.subplots(2, 2, figsize=(7.0, 4.9))
for j, wl in enumerate(["core", "full"]):
    ax = axes[0, j]
    for m in "ABCD":
        s = summ[(summ.wl == wl) & (summ.wm == "warm") & (summ["mode"] == m)].sort_values("N")
        y = s.e2eMs_med.values
        lo = y - s.e2eMs_q1.values
        hi = s.e2eMs_q3.values - y
        st = STYLE[m]
        ax.errorbar(NS * DODGE[m], y, yerr=[lo, hi], color=st["color"], ls=st["ls"], marker=st["marker"],
                    mfc=st["mfc"], mec=st["color"], mew=1.0, ms=4.5, capsize=1.5, elinewidth=0.8, label=st["label"])
    ax.set_yscale("log")
    fmt_n(ax)
    ax.set_ylabel("End-to-end time (ms)")
    ax.set_title(f"({'ab'[j]}) {'IRLS core' if wl == 'core' else 'Full analysis'} workload: median e2e",
                 loc="left", color="#0b0b0b")
    ax.set_yticks([2, 5, 10, 20, 50, 100, 200])
    ax.set_yticklabels(["2", "5", "10", "20", "50", "100", "200"])
    ax.minorticks_off()

    ax = axes[1, j]
    ax.axhline(1.0, color=INK2, lw=0.8, ls=":")
    for key, col, mk, mfc, lab, dd in [("CA", WA, "o", WA, "C/A  (main thread)", 0.96),
                                       ("DB", WA, "s", "white", "D/B  (Web Worker)", 1.04)]:
        r = np.array(RATIO[wl][key])
        ax.errorbar(NS * dd, r[:, 0], yerr=[r[:, 0] - r[:, 1], r[:, 2] - r[:, 0]], color=col,
                    ls="-" if key == "CA" else "--", marker=mk, mfc=mfc, mec=col, mew=1.0, ms=4.5,
                    capsize=2, elinewidth=0.8, label=lab)
    fmt_n(ax)
    ax.set_ylim(0.4, 1.15)
    ax.set_ylabel("Wasm/JS ratio of medians")
    ax.set_xlabel("Number of observations, N (log scale)")
    ax.set_title(f"({'cd'[j]}) {'IRLS core' if wl == 'core' else 'Full analysis'}: Wasm/JS with 95% CI",
                 loc="left", color="#0b0b0b")
    ax.text(1250, 1.005, "parity", fontsize=7, color=INK2, va="bottom")
    ax.legend(loc="lower right", frameon=False)

h = [Line2D([0], [0], color=STYLE[m]["color"], ls=STYLE[m]["ls"], marker=STYLE[m]["marker"],
            mfc=STYLE[m]["mfc"], mec=STYLE[m]["color"], ms=4.5, label=STYLE[m]["label"]) for m in "ABCD"]
fig.legend(handles=h, loc="upper center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 1.03))
fig.tight_layout(rect=(0, 0, 1, 0.97), h_pad=1.2, w_pad=1.5)
fig.savefig("figures/fig_e2e_ratio.pdf")
fig.savefig("figures/fig_e2e_ratio.png", dpi=300)
plt.close(fig)

# ---------- supplementary: frame gaps ----------
fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.6), sharey=True)
for j, wl in enumerate(["core", "full"]):
    ax = axes[j]
    for thr, lab in [(16.7, "one frame (16.7 ms)"), (50, "long task (50 ms)"), (200, "INP 'good' (200 ms)")]:
        ax.axhline(thr, color=INK2, lw=0.7, ls=":")
        if j == 0:
            ax.text(1150, thr * 1.04, lab, fontsize=6.5, color=INK2, va="bottom")
    for m in "ABCD":
        s = summ[(summ.wl == wl) & (summ.wm == "warm") & (summ["mode"] == m)].sort_values("N")
        st = STYLE[m]
        ax.plot(NS * DODGE[m], s.maxFrameGapMs_med.values, color=st["color"], ls=st["ls"], marker=st["marker"],
                mfc=st["mfc"], mec=st["color"], mew=1.0, ms=4.5, label=st["label"])
    ax.set_yscale("log")
    fmt_n(ax)
    ax.set_yticks([10, 20, 50, 100, 200])
    ax.set_yticklabels(["10", "20", "50", "100", "200"])
    ax.minorticks_off()
    ax.set_ylim(10, 320)
    ax.set_xlabel("N (log scale)")
    ax.set_title(f"({'ab'[j]}) {'IRLS core' if wl == 'core' else 'Full analysis'}", loc="left")
axes[0].set_ylabel("Median max. frame gap (ms)")
fig.legend(handles=h, loc="upper center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 1.08))
fig.tight_layout()
fig.savefig("figures/extra/fig_frames.pdf")
fig.savefig("figures/extra/fig_frames.png", dpi=300)
plt.close(fig)

# ---------- supplementary: cold start breakdown ----------
cold = pd.read_csv("analysis/out/cold.csv")
fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.8), sharey=False)
for j, wl in enumerate(["core", "full"]):
    ax = axes[j]
    c = cold[cold.wl == wl].sort_values("N")
    x = np.arange(4)
    w = 0.36
    for k, (m, col) in enumerate([("B", JS), ("D", WA)]):
        xs = x + (k - 0.5) * (w + 0.02)
        st_up = c[f"{m}_spawn"].values + c[f"{m}_init"].values + c[f"{m}_eng"].values
        comp = c[f"{m}_compute"].values
        ax.bar(xs, st_up, w, color=col, alpha=0.35, edgecolor="white", linewidth=1.0)
        ax.bar(xs, comp, w, bottom=st_up, color=col, edgecolor="white", linewidth=1.0)
    ax.set_xticks(x)
    ax.set_xticklabels(["1,470", "10,000", "50,000", "100,000"])
    ax.set_xlabel("N")
    ax.set_title(f"({'ab'[j]}) {'IRLS core' if wl == 'core' else 'Full analysis'}: per-run (cold) worker", loc="left")
axes[0].set_ylabel("Median time (ms)")
hb = [plt.Rectangle((0, 0), 1, 1, color=JS, alpha=0.35), plt.Rectangle((0, 0), 1, 1, color=JS),
      plt.Rectangle((0, 0), 1, 1, color=WA, alpha=0.35), plt.Rectangle((0, 0), 1, 1, color=WA)]
fig.legend(hb, ["B start-up", "B compute", "D start-up", "D compute"], loc="upper center", ncol=4,
           frameon=False, bbox_to_anchor=(0.5, 1.08))
fig.tight_layout()
fig.savefig("figures/extra/fig_cold.pdf")
fig.savefig("figures/extra/fig_cold.png", dpi=300)
plt.close(fig)
print("figures written")

# ---------- Figure 2: worker lifecycle (per-run vs persistent) ----------
cold = pd.read_csv("analysis/out/cold.csv")
# Reported D/B total-time ratios with 95% CI (Table 3, Panel B)
DBC = {"core": [(0.58, 0.54, 0.72), (0.53, 0.52, 0.54), (0.68, 0.67, 0.69), (0.70, 0.70, 0.71)],
       "full": [(0.61, 0.58, 0.64), (0.58, 0.57, 0.59), (0.84, 0.82, 0.85), (0.90, 0.90, 0.91)]}
fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.7))
ax = axes[0]
ax.axhline(1.0, color=INK2, lw=0.8, ls=":")
for m, col, mk in [("B", JS, "o"), ("D", WA, "s")]:
    for wl, ls, mfc in [("core", "-", None), ("full", "--", "white")]:
        c = cold[cold.wl == wl].sort_values("N")
        lab = f"{'B (JS)' if m == 'B' else 'D (Wasm)'}, {'IRLS core' if wl == 'core' else 'full analysis'}"
        ax.plot(NS * (0.97 if wl == "core" else 1.03), c[f"{m}_pen"].values, color=col, ls=ls, marker=mk,
                mfc=col if mfc is None else mfc, mec=col, mew=1.0, ms=4.5, label=lab)
fmt_n(ax)
ax.set_yscale("log")
ax.set_yticks([0.9, 1, 2, 3, 5, 10])
ax.set_yticklabels(["0.9", "1", "2", "3", "5", "10"])
ax.minorticks_off()
ax.set_ylim(0.8, 12)
ax.set_xlabel("N (log scale)")
ax.set_ylabel("Compute time, per-run / persistent")
ax.set_title("(a) Cold penalty on computation", loc="left")
ax.legend(frameon=False, fontsize=6.8, loc="upper right")

ax = axes[1]
ax.axhline(1.0, color=INK2, lw=0.8, ls=":")
for wl, ls, mk, mfc, dd in [("core", "-", "o", WA, 0.97), ("full", "--", "s", "white", 1.03)]:
    r = np.array(DBC[wl])
    ax.errorbar(NS * dd, r[:, 0], yerr=[r[:, 0] - r[:, 1], r[:, 2] - r[:, 0]], color=WA, ls=ls, marker=mk,
                mfc=mfc, mec=WA, mew=1.0, ms=4.5, capsize=2, elinewidth=0.8,
                label="IRLS core" if wl == "core" else "Full analysis")
fmt_n(ax)
ax.set_ylim(0.4, 1.15)
ax.set_xlabel("N (log scale)")
ax.set_ylabel("Total time ratio D/B")
ax.set_title("(b) Per-run workers: Wasm/JS with 95% CI", loc="left")
ax.text(1250, 1.005, "parity", fontsize=7, color=INK2, va="bottom")
ax.legend(frameon=False, loc="lower right")
fig.tight_layout(w_pad=2.0)
fig.savefig("figures/fig_lifecycle.pdf")
fig.savefig("figures/fig_lifecycle.png", dpi=300)
plt.close(fig)
print("lifecycle figure written")
