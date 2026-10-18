#!/usr/bin/env python3
"""Re-analysis of the four benchmark batches (workload core/full x worker lifecycle
persistent/per-run; "warm"/"cold" in the CSV columns).

Produces the summary CSVs in analysis/out/ used by make_tables.py and make_figures.py.
Usage: python analysis/analyze.py  (from reproducibility/; see REPRODUCE.md)
"""
import json
import os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # paths are relative to reproducibility/
import numpy as np
import pandas as pd

RNG = np.random.default_rng(20261016)
B = 4000
D = "data/"
OUT = "analysis/out/"
import os
os.makedirs(OUT, exist_ok=True)

files = {
    ("core", "warm"): "core_warm.csv",
    ("core", "cold"): "core_cold.csv",
    ("full", "warm"): "full_warm.csv",
    ("full", "cold"): "full_cold.csv",
}
frames = []
for (wl, wm), f in files.items():
    df = pd.read_csv(D + f)
    df["wl"] = wl
    df["wm"] = wm
    frames.append(df)
df = pd.concat(frames, ignore_index=True)
NS = [1470, 10000, 50000, 100000]
MODES = list("ABCD")

print("rows:", len(df), "errors:", df["error"].notna().sum(), "hidden:", df["pageHidden"].sum())
print("per batch:", df.groupby(["wl", "wm"]).size().to_dict())


def med(x):
    return float(np.median(x))


def q(x, p):
    return float(np.quantile(x, p))  # type 7 (numpy default)


def boot_ratio(num, den, b=B):
    num = np.asarray(num); den = np.asarray(den)
    i = RNG.integers(0, len(num), (b, len(num)))
    j = RNG.integers(0, len(den), (b, len(den)))
    r = np.median(num[i], axis=1) / np.median(den[j], axis=1)
    return med(num) / med(den), float(np.quantile(r, 0.025)), float(np.quantile(r, 0.975))


def cell(wl, wm, n, m):
    return df[(df.wl == wl) & (df.wm == wm) & (df.N == n) & (df["mode"] == m)]


# ---------- 1. summary per cell ----------
rows = []
for (wl, wm) in files:
    for n in NS:
        for m in MODES:
            c = cell(wl, wm, n, m)
            r = dict(wl=wl, wm=wm, N=n, mode=m, runs=len(c))
            for col in ["computeMs", "e2eMs", "overheadMs", "wasmCoreMs", "formatMs", "totalMs",
                        "maxFrameGapMs", "droppedFrames", "longTaskCount", "longTaskTotalMs",
                        "spawnMs", "initMs", "engineInitMs"]:
                v = c[col].dropna()
                if len(v):
                    r[col + "_med"] = med(v)
                    r[col + "_q1"] = q(v, .25)
                    r[col + "_q3"] = q(v, .75)
                    r[col + "_max"] = float(v.max())
            st = (c["spawnMs"].fillna(0) + c["initMs"].fillna(0) + c["engineInitMs"].fillna(0))
            r["startup_med"] = med(st)
            r["startup_e2e_med"] = med(st + c["e2eMs"])
            r["iterations"] = sorted(c["iterations"].unique().tolist())
            r["stepHalvings"] = sorted(c["stepHalvings"].unique().tolist())
            rows.append(r)
summ = pd.DataFrame(rows)
summ.to_csv(OUT + "summary_cells.csv", index=False)

# ---------- 2. warm e2e table with ratios ----------
print("\n=== Warm e2e medians and ratios (C/A, D/B) ===")
e2e_rows = []
for wl in ["core", "full"]:
    for n in NS:
        meds = {m: med(cell(wl, "warm", n, m).e2eMs) for m in MODES}
        ca = boot_ratio(cell(wl, "warm", n, "C").e2eMs, cell(wl, "warm", n, "A").e2eMs)
        db = boot_ratio(cell(wl, "warm", n, "D").e2eMs, cell(wl, "warm", n, "B").e2eMs)
        iq = {m: (q(cell(wl, "warm", n, m).e2eMs, .25), q(cell(wl, "warm", n, m).e2eMs, .75)) for m in MODES}
        e2e_rows.append(dict(wl=wl, N=n, **{m: meds[m] for m in MODES},
                             **{m + "_iqr": iq[m][1] - iq[m][0] for m in MODES},
                             CA=ca[0], CA_lo=ca[1], CA_hi=ca[2], DB=db[0], DB_lo=db[1], DB_hi=db[2]))
        print(f"{wl:4s} {n:6d} A={meds['A']:.1f} B={meds['B']:.1f} C={meds['C']:.1f} D={meds['D']:.1f} "
              f"C/A={ca[0]:.2f} ({ca[1]:.2f}-{ca[2]:.2f}) D/B={db[0]:.2f} ({db[1]:.2f}-{db[2]:.2f})")
e2e = pd.DataFrame(e2e_rows)
e2e.to_csv(OUT + "e2e_warm_ratios.csv", index=False)

# ---------- 3. OLS slope compute ~ N (warm) ----------
print("\n=== OLS slope of computeMs on N (warm), us/row and intercept ms ===")
slope_rows = []
for wl in ["core", "full"]:
    for m in MODES:
        c = df[(df.wl == wl) & (df.wm == "warm") & (df["mode"] == m)]
        X = c.N.values.astype(float); y = c.computeMs.values
        b1, b0 = np.polyfit(X, y, 1)
        res = y - (b0 + b1 * X)
        r2 = 1 - (res ** 2).sum() / ((y - y.mean()) ** 2).sum()
        # bootstrap CI of slope
        bs = []
        for _ in range(1000):
            i = RNG.integers(0, len(X), len(X))
            bs.append(np.polyfit(X[i], y[i], 1)[0])
        lo, hi = np.quantile(bs, [.025, .975])
        slope_rows.append(dict(wl=wl, mode=m, slope_us=b1 * 1000, lo=lo * 1000, hi=hi * 1000,
                               intercept_ms=b0, r2=r2))
        print(f"{wl} {m}: slope={b1*1000:.3f} us/row [{lo*1000:.3f},{hi*1000:.3f}] intercept={b0:.2f} ms R2={r2:.4f}")
    # wasmCore slope for C/D
    for m in "CD":
        c = df[(df.wl == wl) & (df.wm == "warm") & (df["mode"] == m)]
        b1, b0 = np.polyfit(c.N.values.astype(float), c.wasmCoreMs.values, 1)
        print(f"   {wl} {m} wasmCoreMs slope={b1*1000:.3f} us/row intercept={b0:.2f}")
slopes = pd.DataFrame(slope_rows)
slopes.to_csv(OUT + "slopes.csv", index=False)

# ---------- 4. 2x2 ANOVA on log(e2e) per workload x N (warm) ----------
print("\n=== 2x2 ANOVA on ln(e2e), warm ===")
from scipy import stats
an_rows = []
for wl in ["core", "full"]:
    for n in NS:
        ys = {m: np.log(cell(wl, "warm", n, m).e2eMs.values) for m in MODES}
        # factors: tech (js: A,B ; wasm: C,D), loc (main: A,C ; worker: B,D)
        allv = np.concatenate([ys[m] for m in MODES])
        gm = allv.mean()
        k = len(ys["A"])
        mA, mB, mC, mD = (ys[m].mean() for m in MODES)
        js, wa = (mA + mB) / 2, (mC + mD) / 2
        ma, wo = (mA + mC) / 2, (mB + mD) / 2
        ss_t = 2 * k * ((js - gm) ** 2 + (wa - gm) ** 2)
        ss_l = 2 * k * ((ma - gm) ** 2 + (wo - gm) ** 2)
        ss_cells = k * sum((ys[m].mean() - gm) ** 2 for m in MODES)
        ss_i = ss_cells - ss_t - ss_l
        ss_e = sum(((ys[m] - ys[m].mean()) ** 2).sum() for m in MODES)
        ss_tot = ((allv - gm) ** 2).sum()
        df_e = 4 * (k - 1)
        mse = ss_e / df_e
        F = {"tech": ss_t / mse, "loc": ss_l / mse, "int": ss_i / mse}
        P = {kk: float(stats.f.sf(v, 1, df_e)) for kk, v in F.items()}
        eta = {"tech": ss_t / ss_tot, "loc": ss_l / ss_tot, "int": ss_i / ss_tot}
        # partial eta^2
        peta = {"tech": ss_t / (ss_t + ss_e), "loc": ss_l / (ss_l + ss_e), "int": ss_i / (ss_i + ss_e)}
        tech_eff = np.exp(wa - js) - 1
        loc_eff = np.exp(wo - ma) - 1
        # interaction ratio-of-ratios: (D/B)/(C/A)
        int_eff = np.exp((mD - mB) - (mC - mA)) - 1
        an_rows.append(dict(wl=wl, N=n, tech_eff=tech_eff, loc_eff=loc_eff, int_eff=int_eff,
                            F_tech=F["tech"], p_tech=P["tech"], eta_tech=eta["tech"], peta_tech=peta["tech"],
                            F_loc=F["loc"], p_loc=P["loc"], eta_loc=eta["loc"], peta_loc=peta["loc"],
                            F_int=F["int"], p_int=P["int"], eta_int=eta["int"], peta_int=peta["int"], df_e=df_e))
        print(f"{wl} {n:6d} tech {tech_eff*100:+.1f}% (F={F['tech']:.1f}, p={P['tech']:.2g}, eta2={eta['tech']:.2f}) "
              f"loc {loc_eff*100:+.1f}% (F={F['loc']:.1f}, p={P['loc']:.2g}, eta2={eta['loc']:.3f}) "
              f"int {int_eff*100:+.1f}% (F={F['int']:.1f}, p={P['int']:.2g}, eta2={eta['int']:.3f})")
anova = pd.DataFrame(an_rows)
anova.to_csv(OUT + "factorial_logE2E.csv", index=False)

# ---------- 5. responsiveness (warm) ----------
print("\n=== Responsiveness (warm), medians ===")
for wl in ["core", "full"]:
    for n in NS:
        s = []
        for m in MODES:
            c = cell(wl, "warm", n, m)
            s.append(f"{m}: gap={med(c.maxFrameGapMs):.1f} drop={med(c.droppedFrames):.0f} "
                     f"lt={med(c.longTaskCount):.0f}/{med(c.longTaskTotalMs):.0f}")
        print(wl, n, " | ".join(s))
# worker ranges
w = df[(df.wm == "warm") & (df["mode"].isin(["B", "D"]))]
g = w.groupby(["wl", "N", "mode"]).maxFrameGapMs.median()
print("worker warm gap median range:", g.min(), g.max())
print("worker warm dropped frames medians:", w.groupby(["wl", "N", "mode"]).droppedFrames.median().unique())
print("worker warm long tasks max:", w.longTaskCount.max(), "sum:", w.longTaskCount.sum())
print("worker warm dropped frames max per run:", w.droppedFrames.max())
print("worker warm runs with droppedFrames>0:", (w.droppedFrames > 0).sum(), "of", len(w))
wc = df[(df.wm == "cold") & (df["mode"].isin(["B", "D"]))]
print("worker cold gap median range:", wc.groupby(["wl", "N", "mode"]).maxFrameGapMs.median().agg(["min", "max"]).to_dict())
print("worker cold runs droppedFrames>0:", (wc.droppedFrames > 0).sum(), "of", len(wc), " longtask>0:", (wc.longTaskCount > 0).sum())

# ---------- 6. overhead (warm, worker) ----------
print("\n=== Overhead e2e-compute (warm worker), median [q1,q3] ===")
for wl in ["core", "full"]:
    for n in NS:
        for m in "BD":
            c = cell(wl, "warm", n, m)
            print(f"{wl} {n} {m}: {med(c.overheadMs):.2f} [{q(c.overheadMs,.25):.2f},{q(c.overheadMs,.75):.2f}]")

# ---------- 7. cold ----------
print("\n=== Cold worker ===")
cold_rows = []
for wl in ["core", "full"]:
    for n in NS:
        r = dict(wl=wl, N=n)
        for m in "BD":
            c = cell(wl, "cold", n, m)
            cw = cell(wl, "warm", n, m)
            st = c.spawnMs.fillna(0) + c.initMs.fillna(0) + c.engineInitMs.fillna(0)
            r[m + "_spawn"] = med(c.spawnMs)
            r[m + "_init"] = med(c.initMs.fillna(0))
            r[m + "_eng"] = med(c.engineInitMs.fillna(0))
            r[m + "_startup"] = med(st)
            r[m + "_compute"] = med(c.computeMs)
            r[m + "_e2e"] = med(c.e2eMs)
            r[m + "_pen"] = med(c.computeMs) / med(cw.computeMs)
            r[m + "_tot"] = med(st + c.e2eMs)
            r[m + "_totvals"] = (st + c.e2eMs).values
        rr = boot_ratio(r["D_totvals"], r["B_totvals"])
        r["DB"], r["DB_lo"], r["DB_hi"] = rr
        # also cold e2e-only D/B
        r["DB_e2e"] = boot_ratio(cell(wl, "cold", n, "D").e2eMs, cell(wl, "cold", n, "B").e2eMs)
        del r["D_totvals"], r["B_totvals"]
        cold_rows.append(r)
        print(f"{wl} {n:6d} startup B/D {r['B_startup']:.1f}/{r['D_startup']:.1f} (B spawn {r['B_spawn']:.1f} eng {r['B_eng']:.1f}; D spawn {r['D_spawn']:.1f} init {r['D_init']:.1f}) "
              f"compute B/D {r['B_compute']:.1f}/{r['D_compute']:.1f} pen {r['B_pen']:.2f}/{r['D_pen']:.2f} "
              f"tot {r['B_tot']:.1f}/{r['D_tot']:.1f} D/B={r['DB']:.2f} ({r['DB_lo']:.2f}-{r['DB_hi']:.2f}) e2e-only D/B={r['DB_e2e'][0]:.2f}")
cold = pd.DataFrame([{k: v for k, v in r.items() if k != "DB_e2e"} for r in cold_rows])
cold.to_csv(OUT + "cold.csv", index=False)

# ---------- 8. accuracy ----------
print("\n=== Accuracy vs D (first successful D run per N) ===")
bcols = [c for c in df.columns if c.startswith("B_")]
scols = [c for c in df.columns if c.startswith("SE_")]
acc = []
for (wl, wm) in files:
    for n in NS:
        ref = cell(wl, wm, n, "D").sort_values("runIndex").iloc[0]
        for m in MODES:
            c = cell(wl, wm, n, m)
            db = np.abs(c[bcols].values - ref[bcols].values.astype(float)).max()
            ds = np.abs(c[scols].values - ref[scols].values.astype(float)).max()
            ti = c["tablesIdenticalToD"].dropna()
            acc.append(dict(wl=wl, wm=wm, N=n, mode=m, dBeta=db, dSE=ds,
                            tables=f"{int(ti.astype(str).str.lower().eq('true').sum())}/{len(ti)}" if len(ti) else "",
                            iters=sorted(c.iterations.unique()), sh=sorted(c.stepHalvings.unique()),
                            neg2ll=float(c.neg2ll.iloc[0])))
acc = pd.DataFrame(acc)
acc.to_csv(OUT + "accuracy.csv", index=False)
print(acc.groupby(["wl"]).agg(dBeta=("dBeta", "max"), dSE=("dSE", "max")))
print("C vs D max:", acc[acc["mode"] == "C"][["dBeta", "dSE"]].max().to_dict())
print("tables:", acc[acc.wl == "full"].tables.unique())
print("iterations:", set(sum(acc.iters.tolist(), [])), "stephalvings:", set(sum(acc.sh.tolist(), [])))
print("-2LL at N=1470:", acc[(acc.N == 1470)].neg2ll.unique()[:4])

# ---------- 9. main-thread init and warm worker init ----------
for k in ["core_warm", "full_warm"]:
    meta = json.load(open(D + k + "_meta.json"))
    print(k, "mainThreadInit", meta["mainThreadInit"], "warmWorkerInit", meta["warmWorkerInit"],
          "refresh", meta["environment"]["refreshIntervalMs"], "timer", meta["environment"]["timerResolutionMs"])

# ---------- 10. JS worker vs JS main (warm) ----------
print("\n=== JS worker vs main compute (warm) B/A, D/C ===")
for wl in ["core", "full"]:
    for n in NS:
        ba = med(cell(wl, "warm", n, "B").computeMs) / med(cell(wl, "warm", n, "A").computeMs)
        dc = med(cell(wl, "warm", n, "D").computeMs) / med(cell(wl, "warm", n, "C").computeMs)
        print(f"{wl} {n}: B/A compute={ba:.3f}  D/C compute={dc:.3f}")

# formatMs
print("\nformatMs median range (full):", df[df.wl == "full"].groupby(["wm", "N", "mode"]).formatMs.median().agg(["min", "max"]).to_dict())
# wasm serialize / boundary in full
f = df[(df.wl == "full") & (df["mode"].isin(["C", "D"]))]
print("full C/D: compute - wasmCore median by N:", (f.assign(b=f.computeMs - f.wasmCoreMs).groupby(["wm", "N", "mode"]).b.median()).round(2).to_dict())
print("full C/D wasmSerializeMs median by N:", f.groupby(["wm", "N", "mode"]).wasmSerializeMs.median().round(3).to_dict())
c_ = df[(df.wl == "core") & (df["mode"].isin(["C", "D"]))]
print("core C/D: compute - wasmCore median by N:", (c_.assign(b=c_.computeMs - c_.wasmCoreMs).groupby(["wm", "N", "mode"]).b.median()).round(2).to_dict())
print("wasmMemoryMB max:", df.groupby(["wl", "mode"]).wasmMemoryMB.max().to_dict())
