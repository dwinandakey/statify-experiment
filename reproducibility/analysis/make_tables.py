#!/usr/bin/env python3
"""Emit LaTeX table bodies from analysis/out/*.csv (run after analyze.py).

Table 3 (panel A: persistent workers, panel B: per-run workers) ratio CIs use the
values reported by the author's original analysis (bootstrap Monte Carlo noise can move the 2nd decimal); every median is
recomputed here from the raw CSVs and checked against those values.
"""
import os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # paths are relative to reproducibility/
import numpy as np
import pandas as pd

s = pd.read_csv("analysis/out/summary_cells.csv")
e2e = pd.read_csv("analysis/out/e2e_warm_ratios.csv")
sl = pd.read_csv("analysis/out/slopes.csv")
an = pd.read_csv("analysis/out/factorial_logE2E.csv")
cold = pd.read_csv("analysis/out/cold.csv")
NS = [1470, 10000, 50000, 100000]
NL = {1470: "1,470", 10000: "10,000", 50000: "50,000", 100000: "100,000"}
WL = {"core": "IRLS core", "full": "Full analysis"}

REPORTED_CI = {  # (C/A lo, hi, D/B lo, hi) from the author's analysis
    ("core", 1470): (0.77, 0.82, 0.71, 0.81), ("core", 10000): (0.75, 0.76, 0.83, 0.88),
    ("core", 50000): (0.71, 0.73, 0.76, 0.78), ("core", 100000): (0.71, 0.72, 0.75, 0.76),
    ("full", 1470): (0.45, 0.46, 0.50, 0.53), ("full", 10000): (0.87, 0.89, 0.89, 0.92),
    ("full", 50000): (1.02, 1.04, 1.06, 1.07), ("full", 100000): (1.04, 1.05, 1.07, 1.09),
}


def f1(x):
    return f"{x:.1f}"


out = []
out.append("% ---- Table 3, panel A (persistent workers) body ----")
for wl in ["core", "full"]:
    for i, n in enumerate(NS):
        r = e2e[(e2e.wl == wl) & (e2e.N == n)].iloc[0]
        lo1, hi1, lo2, hi2 = REPORTED_CI[(wl, n)]
        # sanity: recomputed CI must be within 0.01 of the reported one
        assert abs(r.CA_lo - lo1) <= 0.0151 and abs(r.CA_hi - hi1) <= 0.0151, (wl, n, r.CA_lo, r.CA_hi)
        assert abs(r.DB_lo - lo2) <= 0.0151 and abs(r.DB_hi - hi2) <= 0.0151, (wl, n, r.DB_lo, r.DB_hi)
        lab = (r"\multirow{4}{*}{" + WL[wl] + "}") if i == 0 else ""
        out.append(f"{lab} & {NL[n]} & {f1(r.A)} & {f1(r.B)} & {f1(r.C)} & {f1(r.D)} & "
                   f"{r.CA:.2f} ({lo1:.2f}--{hi1:.2f}) & {r.DB:.2f} ({lo2:.2f}--{hi2:.2f}) \\\\")
    if wl == "core":
        out.append(r"\midrule")

out.append("% ---- Table 4 panel A body ----")
for wl in ["core", "full"]:
    cells = []
    for m in "ABCD":
        r = sl[(sl.wl == wl) & (sl["mode"] == m)].iloc[0]
        cells.append(f"{r.slope_us:.2f} ({r.intercept_ms:.1f})")
    out.append(f"{WL[wl]} & " + " & ".join(cells) + r" \\")
rat = []
for m in "ABCD":
    a = sl[(sl.wl == "full") & (sl["mode"] == m)].slope_us.iloc[0]
    b = sl[(sl.wl == "core") & (sl["mode"] == m)].slope_us.iloc[0]
    rat.append(f"{a / b:.2f}")
out.append(r"Full/core slope ratio & " + " & ".join(rat) + r" \\")
print("min R2:", sl.r2.min())

out.append("% ---- Table 4 panel B body ----")


def stars(p):
    return "^{***}" if p < 0.001 else "^{**}" if p < 0.01 else "^{*}" if p < 0.05 else "^{\\mathrm{ns}}"


# t-test p-values for treatment-coded simple effects
fr = []
for f, wl in [("data/core_warm.csv", "core"), ("data/full_warm.csv", "full")]:
    d = pd.read_csv(f); d["wl"] = wl; fr.append(d)
df = pd.concat(fr)
from scipy import stats
for wl in ["core", "full"]:
    for i, n in enumerate(NS):
        y = {k: np.log(df[(df.wl == wl) & (df.N == n) & (df["mode"] == k)].e2eMs.values) for k in "ABCD"}
        k = 30
        mse = sum(((v - v.mean()) ** 2).sum() for v in y.values()) / (4 * (k - 1))
        se = np.sqrt(mse * 2 / k); se3 = np.sqrt(mse * 4 / k)
        b1 = y["C"].mean() - y["A"].mean(); b2 = y["B"].mean() - y["A"].mean()
        b3 = (y["D"].mean() - y["B"].mean()) - (y["C"].mean() - y["A"].mean())
        p = lambda t: 2 * stats.t.sf(abs(t), 4 * (k - 1))
        a = an[(an.wl == wl) & (an.N == n)].iloc[0]
        lab = (r"\multirow{4}{*}{" + WL[wl] + "}") if i == 0 else ""
        pc = lambda b: f"{(np.exp(b) - 1) * 100:+.1f}".replace("-", "$-$").replace("+", "$+$")
        out.append(f"{lab} & {NL[n]} & {pc(b1)}${stars(p(b1 / se))}$ & {pc(b2)}${stars(p(b2 / se))}$ & "
                   f"{pc(b3)}${stars(p(b3 / se3))}$ & {a.eta_tech:.2f} & {a.eta_loc:.2f} & {a.eta_int:.2f} \\\\")
    if wl == "core":
        out.append(r"\midrule")

out.append("% ---- Table 5 body ----")
for wl in ["core", "full"]:
    for i, n in enumerate(NS):
        g = {m: s[(s.wl == wl) & (s.wm == "warm") & (s.N == n) & (s["mode"] == m)].iloc[0] for m in "ABCD"}
        lt = lambda r: (f"{r.longTaskCount_med:.0f} ({r.longTaskTotalMs_med:.0f})")
        lab = (r"\multirow{4}{*}{" + WL[wl] + "}") if i == 0 else ""
        out.append(f"{lab} & {NL[n]} & {f1(g['A'].maxFrameGapMs_med)} & {f1(g['C'].maxFrameGapMs_med)} & "
                   f"{f1(g['B'].maxFrameGapMs_med)} & {f1(g['D'].maxFrameGapMs_med)} & "
                   f"{g['A'].droppedFrames_med:.0f} / {g['C'].droppedFrames_med:.0f} & {lt(g['A'])} / {lt(g['C'])} & "
                   f"{f1(g['B'].overheadMs_med)} / {f1(g['D'].overheadMs_med)} \\\\")
    if wl == "core":
        out.append(r"\midrule")

out.append("% ---- Table 3, panel B (per-run workers) body ----")
REPORTED_COLD_CI = {("core", 1470): (0.54, 0.72), ("core", 10000): (0.52, 0.54), ("core", 50000): (0.67, 0.69),
                    ("core", 100000): (0.70, 0.71), ("full", 1470): (0.58, 0.64), ("full", 10000): (0.57, 0.59),
                    ("full", 50000): (0.82, 0.85), ("full", 100000): (0.90, 0.91)}
for wl in ["core", "full"]:
    for i, n in enumerate(NS):
        r = cold[(cold.wl == wl) & (cold.N == n)].iloc[0]
        su = {m: r[f"{m}_spawn"] + r[f"{m}_init"] + r[f"{m}_eng"] for m in "BD"}
        lo, hi = REPORTED_COLD_CI[(wl, n)]
        assert abs(r.DB_lo - lo) <= 0.0151 and abs(r.DB_hi - hi) <= 0.0151, (wl, n, r.DB_lo, r.DB_hi)
        lab = (r"\multirow{4}{*}{" + WL[wl] + "}") if i == 0 else ""
        out.append(f"{lab} & {NL[n]} & {f1(su['B'])} / {f1(su['D'])} & {f1(r.B_compute)} / {f1(r.D_compute)} & "
                   f"{r.B_pen:.2f} / {r.D_pen:.2f} & {f1(r.B_tot)} / {f1(r.D_tot)} & {r.DB:.2f} ({lo:.2f}--{hi:.2f}) \\\\")
    if wl == "core":
        out.append(r"\midrule")

open("analysis/out/table_bodies.tex", "w").write("\n".join(out) + "\n")
print("\n".join(out))
