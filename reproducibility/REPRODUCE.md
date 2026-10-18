# Reproducing the results

Artifact for the article *Execution Strategies for Client-Side Statistical Computing: A Factorial
Case Study of WebAssembly, Web Workers, and Worker Lifecycle in Logistic Regression*.

The repository is the full Statify application. The experiment lives in the menu
**Analyze → Regression → Binary Logistic (Experiment)**; its design, metrics and protocol are
documented in
[`frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/EXPERIMENT.md`](../frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/EXPERIMENT.md).

| Folder / file | Content |
|---|---|
| `data/` | The four measured batches reported in the article: per-run CSV + `meta.json` each |
| `analysis/analyze.py` | Per-cell summaries, Wasm/JS ratios with bootstrap CIs, OLS slopes, two-way ANOVA on ln(e2e), per-run (cold) start-up, accuracy → `analysis/out/` |
| `analysis/make_tables.py` | LaTeX rows of Tables 3–5 → `analysis/out/table_bodies.tex` |
| `analysis/make_figures.py` | Figures 1–2 → `figures/` (plus supplementary figures in `figures/extra/`) |
| `requirements.txt` | Python packages (pinned) |
| `provenance/` | Evidence for the build that produced the data (Section 3) |

## 1. Tables 3–5 and Figures 1–2 from the included data (about one minute)

```bash
git clone https://github.com/dwinandakey/statify-experiment.git
cd statify-experiment
git checkout experiment-v1.0.0
cd reproducibility
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python analysis/analyze.py
python analysis/make_tables.py
python analysis/make_figures.py
```

The scripts can be started from any folder; paths are resolved relative to `reproducibility/`.

| Article | Output |
|---|---|
| Table 3, panel A (persistent workers) and panel B (per-run workers) | `analysis/out/table_bodies.tex`, blocks `Table 3, panel A` and `Table 3, panel B` |
| Table 4, panels A (cost per observation) and B (factorial decomposition) | blocks `Table 4 panel A` and `Table 4 panel B` |
| Table 5 (responsiveness and messaging overhead) | block `Table 5` |
| Figure 1 | `figures/fig_e2e_ratio.pdf` |
| Figure 2 | `figures/fig_lifecycle.pdf` |

Tables 1 and 2 describe the design and the algorithm and contain no measured values.

Medians, IQRs, ratios of medians, slopes, ANOVA effects, start-up times and accuracy are computed
from the CSV files. Bootstrap confidence intervals use 4,000 resamples with the fixed seed
20261016, so they are deterministic. The CI bounds printed in Table 3 and drawn in Figures 1–2 are
the values of the author's original analysis, written into the scripts (`REPORTED_CI` and
`REPORTED_COLD_CI` in `make_tables.py`, `RATIO` and `DBC` in `make_figures.py`);
`make_tables.py` recomputes them and stops if any bound differs by more than 0.015.

Checked on Windows 11 with Python 3.12.2 and the versions in `requirements.txt`: every output in
`analysis/out/` matched the author's analysis package up to floating-point noise (≤ 9e-15
relative).

## 2. Data

All four batches ran on 16 October 2026 between 16:18 and 16:28 UTC in one session of Google
Chrome 155 (user agent reduced to `Chrome/155.0.0.0`) on Windows 11, AMD Ryzen 5 5500U
(12 logical cores), 16 GB RAM, 60 Hz display, on AC power, from a production build served by
`next start` with COOP/COEP headers (`crossOriginIsolated = true`, timer resolution 5 µs).

| Files | Batch id | Workload | Worker lifecycle |
|---|---|---|---|
| `core_warm.csv`, `core_warm_meta.json` | `batch-20261016161853` | IRLS core | persistent |
| `core_cold.csv`, `core_cold_meta.json` | `batch-20261016162048` | IRLS core | per-run |
| `full_warm.csv`, `full_warm_meta.json` | `batch-full-20261016162332` | full analysis | persistent |
| `full_cold.csv`, `full_cold_meta.json` | `batch-full-20261016162546` | full analysis | per-run |

"warm" and "cold" are the names used inside the files (`workerStart`, `coldWorkers`): warm =
persistent worker reused across runs, cold = new worker for every run (per-run). Main-thread
modes A and C have no worker; their rows are the same configuration in both lifecycle batches.

Each CSV has 480 rows: 4 data sizes (N = 1,470, 10,000, 50,000, 100,000) × 30 repetitions ×
4 configurations (A JavaScript/main thread, B JavaScript/worker, C Wasm/main thread, D Wasm/
worker), after 5 unrecorded warm-up rounds per N; mode order shuffled per repetition; resampling
seed 42. Column definitions: EXPERIMENT.md §5. The `meta.json` files hold the settings,
environment, one-time initialisation costs and the shuffled orders.

Dataset: IBM HR Analytics Employee Attrition & Performance (1,470 rows, 35 columns), model
`Attrition ~ Age + BusinessTravel + DistanceFromHome + MaritalStatus + MonthlyIncome + MonthlyRate
+ OverTime + TotalWorkingYears + YearsAtCompany` (BusinessTravel, MaritalStatus and OverTime
nominal, indicator coding with the last category as reference; p = 12). The CSV is not
redistributed here. The copy used for verification had SHA-256
`a5c31e38bd7fafc9bc333884eb181b06b41b8e5e488e8f7ccb27199fb3be7659`; with it the model gives
−2LL = 1079.4805 at N = 1,470 and coefficients equal to the `B_*` columns of the data files.

## 3. Provenance of the measured build

**The `gitCommit` field in the four `meta.json` files reads `2c8bb04a`, and that value is wrong.**
The build that produced the data was made from commit `b6747315` (application code identical to
`a426f035`; the two commits differ only in a test file). The label came from a
`NEXT_PUBLIC_GIT_COMMIT` variable set in the same terminal earlier that day, when `2c8bb04a` was
checked out, and reused by a later plain `next build`.

Evidence:

1. `2c8bb04a` predates the code that wrote these files. Its sources have no workload selection and
   no `calculate_binary_logistic_timed` export, while the data contain a `workload` column, full
   analysis batches, and columns introduced in `a426f035` (`wasmSerializeMs`, `longGapCount`,
   `frameIntervalMs`, `mainHeapUsedMB`, `tablesHash`). `2c8bb04a` is not on any public branch:
   it was rewritten into `fd663900` when commit messages were edited before the first push.
2. `provenance/next-build-chunk-9446.0838280698f12ad8.js` is a client chunk of that build
   (SHA-256 `82a0c73d40e4c862980789e48c4c7b47a5b8d4a883e7c3ba95e50cb624ab95d0`;
   `provenance/BUILD_ID` is its build id). On the build machine the chunk was written at
   16:12:22 UTC and `BUILD_ID` at 16:13:22 UTC, after commit `b6747315` (16:06:53 UTC) and before
   the first batch (16:18:54 UTC). The chunk contains both the literal `gitCommit:"2c8bb04a"` and
   the code of `a426f035`, for example the call to `calculate_binary_logistic_timed`.
3. The WebAssembly package that was measured is the one in this tag:
   `git diff --stat a426f035 experiment-v1.0.0 -- frontend/public/workers/Regression/BinaryExperiment/pkg`
   prints nothing. Rebuilding it with the pinned toolchain and `Cargo.lock`
   (`npm run build:wasm:experiment -- --check`) gives byte-identical files on the original build
   machine (`statify_logistic_bg.wasm` SHA-256
   `3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d`).

`npm run build:experiment` now always sets `NEXT_PUBLIC_GIT_COMMIT` from `git rev-parse --short
HEAD`, ignores any value already in the environment, and appends `-dirty` when tracked files
are modified.

## 4. Re-running the measurements

Requirements:

| Tool | Version used | Note |
|---|---|---|
| Node.js | 22.18.0 | `npm install` at the repository root (npm workspaces) |
| Next.js | 15.5.9 | locked in `package-lock.json` |
| Rust | 1.91.1 + `wasm32-unknown-unknown` | pinned by `rust-toolchain.toml` in the crate; rustup installs it |
| wasm-pack | 0.13.1 | `cargo install wasm-pack --version 0.13.1 --locked`; it downloads wasm-bindgen 0.2.129 (from `Cargo.lock`) and wasm-opt |
| Crates | nalgebra 0.32.6, statrs 0.16.1, serde_json 1.0.154, wasm-bindgen 0.2.129 | locked in `frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust/Cargo.lock` |
| Browser | Google Chrome 155 | `longtask` and `performance.memory` exist only in Chromium |

The build scripts are Node scripts and run on Windows, Linux and macOS:

```bash
npm install
cd frontend
npm run build:wasm:experiment -- --check   # optional: rebuild the Wasm package and compare it
npm run build:experiment                   # production build; records the commit in meta.json
npm run start                              # http://localhost:3001
```

`--check` compares SHA-256 hashes without overwriting the committed package. On another machine
the hashes differ even with the same toolchain, because rustc embeds absolute source paths of the
dependencies (`~/.cargo/registry/...`) in panic messages; functional equality is covered by
`scripts/checkEnterParity.mjs` and the Jest golden tests (EXPERIMENT.md §7–8). Without `--check`
the script copies the rebuilt files into `frontend/public/workers/Regression/BinaryExperiment/pkg`.

**Manual protocol (how the article data were collected).** Follow EXPERIMENT.md §9 in a normal
Chrome window. Load the dataset, select the variables above, open the Experiment tab, keep the
default batch settings (sizes original + 10,000 + 50,000 + 100,000, warm-up 5, repetitions 30,
seed 42) and run four batches, downloading the CSV and `meta.json` after each:

| Batch | Workload | "Fresh worker per run (cold)" |
|---|---|---|
| 1 | IRLS core | unchecked (persistent) |
| 2 | IRLS core | checked (per-run) |
| 3 | Full analysis + SPSS tables | unchecked (persistent) |
| 4 | Full analysis + SPSS tables | checked (per-run) |

**Automated runner.** `tests/experiment/benchmark-workloads.spec.ts` drives the same four batches
headless with Playwright (from the repository root, after the production build; it starts its
own server on the given port):

```bash
EXPERIMENT_BENCH_DATA=/path/to/HR-Employee-Attrition.csv \
EXPERIMENT_BENCH_CHANNEL=chrome \
EXPERIMENT_PORT=3002 \
npx playwright test -c tests/experiment/playwright.experiment.config.ts benchmark-workloads
```

PowerShell: set the same variables with `$env:NAME = "value"` first. The default
`EXPERIMENT_BENCH_WORKLOADS` is `core,core:per-run,full,full:per-run`; files go to
`benchmark-results/` (per-run batches with the suffix `-per-run`) together with `browser.txt`
(exact browser version). The article data were collected manually in a visible window, not with
this runner.

**Analysing new data.** Copy the four new CSV/`meta.json` pairs into `data/` with the file names
of Section 2 and run the three scripts. `make_tables.py` and `make_figures.py` contain the CI
bounds reported in the article; for new data, replace `REPORTED_CI`, `REPORTED_COLD_CI`, `RATIO`
and `DBC` with the recomputed values in `analysis/out/e2e_warm_ratios.csv` and
`analysis/out/cold.csv`, otherwise the consistency check in `make_tables.py` stops.
