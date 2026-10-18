# Reproduksi eksperimen v2: dari clone sampai data mentah

Panduan ini menghasilkan data mentah **eksperimen v2** menu *Analyze → Regression → Binary
Logistic (Experiment)*: sesi benchmark selang-seling di Chrome dan Firefox rilis resmi
(6 sel interleaved, workload core dan full, dataset CDC BRFSS 100.000 baris), pembanding
native, dan validasi. Desain, metrik, dan keterbatasan dijelaskan di
[`frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/EXPERIMENT.md`](frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/EXPERIMENT.md)
(§4, §5, §9a, §10).

Artefak v1 (artikel SAUCIS: data empat batch, skrip tabel dan gambar) ada di tag
`experiment-v1.0.0`, panduannya di [`reproducibility/REPRODUCE.md`](reproducibility/REPRODUCE.md).
Kode build yang menghasilkan data v1 ada di tag `saucis-v1-data`.

## 1. Prasyarat

| Alat | Versi yang dipakai | Catatan |
|---|---|---|
| Git | 2.45 | |
| Node.js | 22.18.0 (≥ 22.12 untuk Puppeteer 25) | npm workspaces di root repo |
| Rust (rustup) | 1.91.1 | dipatok `rust-toolchain.toml` di crate; rustup memasangnya otomatis. Hanya untuk pembanding native dan `cargo test`; paket wasm yang diukur sudah ter-commit |
| Google Chrome | rilis stabil (uji: 155.0.8059.80) | build resmi, bukan Chromium Playwright |
| Mozilla Firefox | rilis (uji: 158.0) | build resmi |
| Puppeteer | `puppeteer-core` 25.12.0 | terpasang lewat `npm install` (devDependency root); tidak mengunduh browser |

Data mentah dihasilkan di Windows 11 (AMD Ryzen 5 5500U, 16 GB RAM, layar 1920×1080 skala 165%).
Di Linux, alur dan perintahnya sama, kecuali dua hal: path browser di konfigurasi, dan helper
foreground jendela, yang hanya ada di Windows (di Linux statusnya dicatat `null` dan tidak
diperiksa validator).

## 2. Clone, install, dan cek awal

Windows (PowerShell):

```powershell
git clone https://github.com/dwinandakey/statify-experiment.git
cd statify-experiment
git checkout experiment-v2
npm install
cd frontend\components\Modals\Analyze\Regression\BinaryLogistic\rust
cargo test --locked
cd ..\..\..\..\..\..
npx jest __tests__/irlsCore.experiment.test.js __tests__/binaryLogisticExperiment __tests__/logisticEnterParity.experiment.test.js
cd ..
```

Linux (bash):

```bash
git clone https://github.com/dwinandakey/statify-experiment.git
cd statify-experiment
git checkout experiment-v2
npm install
(cd frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust && cargo test --locked)
(cd frontend && npx jest __tests__/irlsCore.experiment.test.js __tests__/binaryLogisticExperiment __tests__/logisticEnterParity.experiment.test.js)
```

Test Jest `binaryLogisticExperiment.artifacts` memastikan paket wasm adalah biner yang diukur
(SHA-256 `3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d`); jangan
menjalankan `npm run build:wasm:experiment` tanpa `--check`.

## 3. Dataset

`experiment-data/brfss_bench_100k.csv` sudah ter-commit (byte demi byte; SHA-256
`95db7a4624c746b915d04e5abec7d7c0a29ac3b866cc1b66c5d6ef004bf5a3fa`). Untuk membuatnya ulang dari
sumber:

1. Unduh `diabetes_binary_health_indicators_BRFSS2015.csv` (Kaggle, *Diabetes Health
   Indicators Dataset*; dataset yang sama di UCI, doi:10.24432/C53919) ke
   `experiment-data/raw/`. Salinan yang dipakai: 253.680 baris data, SHA-256
   `19f367e3e3350768f0c144c5d73ee5b355f67a57eaaa86ca7bd8aec594d8b1d0`.
2. Jalankan skrip persiapan dari root repo (Windows dan Linux sama):

   ```bash
   node frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/prepareBrfss.mjs experiment-data/raw/diabetes_binary_health_indicators_BRFSS2015.csv
   ```

   Hasilnya harus byte-identik dengan file ter-commit (`git status` bersih;
   `brfss_bench_100k.manifest.json` hanya berbeda di `generatedAt`).

## 4. Production build

```bash
cd frontend
npm run build:experiment
cd ..
```

Build ditolak bila working tree dirty (file terlacak berubah); nilai `gitCommit` di setiap
meta.json = `git describe --always --dirty --abbrev=8`. Jangan biarkan server lain memakai
port 3002: orkestrator menyalakan `next start` sendiri di port itu.

## 5. Konfigurasi orkestrator

`tests/experiment/bench.v2.json` (sesi ukur) dan `tests/experiment/bench.v2.mini.json` (dry run).
Path browser bawaannya untuk Windows; di Linux ubah `executablePath`, misalnya:

```json
"browsers": [
  { "name": "chrome", "executablePath": "/usr/bin/google-chrome" },
  { "name": "firefox", "executablePath": "/usr/bin/firefox" }
]
```

(Firefox snap di Ubuntu: `/snap/bin/firefox`.) Pengaturan lain tidak perlu diubah: N
{1.000; 10.000; 50.000; 100.000}, warm-up 5, ulangan 30, sampling prefix, urutan N diacak,
lifecycle interleaved, 1 pilot + 10 sesi per browser, cooldown 120 s, `orderSeedBase` 1000.

## 6. Persiapan mesin

- Laptop dicolok charger; mode daya *Best performance* (Windows) atau governor *performance*
  (Linux); battery saver mati.
- Tutup aplikasi lain; matikan notifikasi, pembaruan otomatis, dan antivirus scan terjadwal
  bila memungkinkan; layar tidak boleh mati atau terkunci selama run.
- **Jangan memakai komputer selama run.** Orkestrator membawa jendela browser ke foreground
  sebelum setiap batch (Windows); input pengguna akan merusak status foreground dan visibilitas
  yang divalidasi.

## 7. Dry run (sekitar 5 menit)

Windows (PowerShell):

```powershell
node tests/experiment/orchestrate.mjs --config tests/experiment/bench.v2.mini.json --run-id dryrun
cd frontend
node scripts/validateRun.mjs ..\benchmark-results\dryrun
node scripts/runNative.mjs ..\benchmark-results\dryrun --invocations 1 --pause-sec 0
cd ..
```

Linux (bash):

```bash
node tests/experiment/orchestrate.mjs --config tests/experiment/bench.v2.mini.json --run-id dryrun
(cd frontend && node scripts/validateRun.mjs ../benchmark-results/dryrun)
(cd frontend && node scripts/runNative.mjs ../benchmark-results/dryrun --invocations 1 --pause-sec 0)
```

Validator harus mencetak **LULUS** dan cek native **PASS**. Hasil dry run bukan data artikel.

## 8. Sesi ukur

Windows (PowerShell):

```powershell
node tests/experiment/orchestrate.mjs --plan                 # jadwal, seed, dan urutan workload
node tests/experiment/orchestrate.mjs                        # runId = waktu mulai (dicetak di awal)
node tests/experiment/orchestrate.mjs --run-id <runId>       # lanjutkan bila terputus; sesi lengkap dilewati
node tests/experiment/orchestrate.mjs --run-id <runId> --only firefox-04   # ulangi satu sesi
cd frontend
node scripts/runNative.mjs ..\benchmark-results\<runId>      # 10 proses native, jeda 10 s
node scripts/validateRun.mjs ..\benchmark-results\<runId>    # validation.md dan validation.json
```

Linux (bash):

```bash
node tests/experiment/orchestrate.mjs --plan
node tests/experiment/orchestrate.mjs
node tests/experiment/orchestrate.mjs --run-id <runId>
node tests/experiment/orchestrate.mjs --run-id <runId> --only firefox-04
(cd frontend && node scripts/runNative.mjs ../benchmark-results/<runId>)
(cd frontend && node scripts/validateRun.mjs ../benchmark-results/<runId>)
```

## 9. Data mentah yang dihasilkan

```text
benchmark-results/<runId>/
  run.json                          konfigurasi, jadwal, build (BUILD_ID, git describe), SHA-256 dataset, versi alat
  design/N<N>.X.f64, .y.f64, .json  design matrix workload core per N (Float64 LE) untuk pembanding native
  chrome/pilot-01/, firefox/pilot-01/
  chrome/measure-01/ … measure-10/, firefox/measure-01/ … measure-10/
      batch-<stamp>.csv, batch-<stamp>-meta.json             workload core (840 run)
      batch-full-<stamp>.csv, batch-full-<stamp>-meta.json   workload full (840 run)
      session.json                  host, browser.version(), argumen peluncuran, user.js Firefox,
                                    status foreground jendela per batch, waktu, status, error
  native/invocation-01.csv … -10.csv, native.json            pembanding native + hasil cek vs D-warm
  validation.md, validation.json                             hasil validateRun.mjs
```

Kolom CSV dan field meta.json: EXPERIMENT.md §5. `benchmark-results/` ada di `.gitignore`.
Simpan run final secara permanen (mis. salin ke `reproducibility/` dengan `.gitattributes -text`
seperti data v1) sebelum dianalisis.
