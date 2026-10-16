# Eksperimen 2×2: WebAssembly dan Web Worker untuk Regresi Logistik Biner

Dokumen ini menjelaskan desain, implementasi, metrik, prosedur, dan keterbatasan
menu **Analyze → Regression → Binary Logistic (Experiment)**. Isinya disusun
sebagai bahan bagian *Method* artikel *Evaluating WebAssembly and Web Workers
for Browser-Based Statistical Computing*.

## 1. Tujuan

Memisahkan kontribusi dua faktor terhadap kinerja dan responsivitas komputasi
statistik di browser, dengan algoritma IRLS regresi logistik biner sebagai beban kerja:

1. **Teknologi komputasi**: JavaScript (JIT V8) vs Rust yang dikompilasi ke WebAssembly.
2. **Lokasi eksekusi**: main thread (UI thread) vs Web Worker (thread terpisah).

Statify produksi hanya memakai konfigurasi D. Eksperimen ini menjalankan keempat
kombinasi dengan inti algoritma yang identik, sehingga perbedaan yang terukur
berasal dari runtime dan lokasi eksekusi, bukan dari perbedaan algoritma atau
library aljabar.

## 2. Desain faktorial

| Kode | Teknologi | Lokasi | Kode yang dijalankan |
|---|---|---|---|
| A | JavaScript | Main thread | `irls_core.js` via `import()` di main thread |
| B | JavaScript | Web Worker | `irls_core.js` via `jsCore.worker.js` |
| C | Rust-WebAssembly | Main thread | `pkg/statify_logistic.js` → `irls_core_bench` di main thread |
| D | Rust-WebAssembly | Web Worker | `pkg/statify_logistic.js` → `irls_core_bench` via `wasmCore.worker.js` |

Kontras yang bisa diestimasi dari data per run (CSV):

- Efek utama teknologi: (A + B) vs (C + D).
- Efek utama lokasi: (A + C) vs (B + D).
- Interaksi: (A − B) − (C − D), yaitu apakah biaya memindahkan kerja ke worker
  berbeda untuk JS dan Wasm.

Semua file eksperimen:

| Lokasi | Isi |
|---|---|
| `frontend/public/workers/Regression/BinaryExperiment/irls_core.js` | Inti IRLS JavaScript (ES module mandiri, tanpa dependency) |
| `frontend/public/workers/Regression/BinaryExperiment/logistic_enter.js` | Port JavaScript analisis Binary Logistic produksi (Enter) untuk tombol OK di mode A/B (§6, *Tombol OK*) |
| `frontend/public/workers/Regression/BinaryExperiment/jsCore.worker.js` | Worker mode B |
| `frontend/public/workers/Regression/BinaryExperiment/wasmCore.worker.js` | Worker mode D |
| `frontend/public/workers/Regression/BinaryExperiment/pkg/` | Paket wasm eksperimen (hasil `wasm-pack --target web`) |
| `frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/` | Inti IRLS Rust (`irls_core.rs`) + golden test data |
| `frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/` | Dialog, services, tipe, skrip (`scripts/`), dokumen ini |
| `frontend/__tests__/irlsCore.experiment.test.js`, `binaryLogisticExperiment.*.test.ts`, `logisticEnterParity.experiment.test.js` | Unit test Jest |
| `tests/experiment/` | E2E Playwright (config terpisah + fixture CSV) |

Modul Binary Logistic produksi, worker produksi, dan paket wasm produksi
(`public/workers/Regression/Binary/pkg`) tidak diubah. Crate Rust produksi hanya
ditambah modul `bench` dan satu fungsi ekspor baru `irls_core_bench`.

## 3. Spesifikasi algoritma

Kedua inti (JS dan Rust) mengimplementasikan spesifikasi yang sama persis,
termasuk urutan operasi. Struktur loop Rust mencerminkan versi JS baris demi
baris. Spesifikasi ini meniru `irls::fit` produksi (`rust/src/stats/irls.rs`)
**tanpa** cek condition number berbasis SVD.

```
konstanta: PROB_MIN = 1e-10, PROB_MAX = 1 - 1e-10, W_MIN = 1e-10,
           RIDGE = 1e-9, MAX_HALVING = 10, HALVING = 0.5

beta = 0 (p)
ll_prev = -Infinity
untuk iter = 0 .. maxIter-1:
  mu_i = clamp(1 / (1 + exp(-(x_i · beta))), PROB_MIN, PROB_MAX)
  w_i  = max(mu_i (1 - mu_i), W_MIN)
  g    = Xᵀ (y - mu)                          // p
  H    = Xᵀ W X  (+ RIDGE pada diagonal)      // p×p, hitung segitiga atas lalu cerminkan
  delta = solve(H, g) via Cholesky            // gagal (tidak PD) → throw Error
  ll_cur = (iter == 0) ? LL(mu) : ll_prev
  // step-halving, meniru step_halving_search produksi:
  step = 1; beta_new = beta + delta; mu_new, ll_new
  ulangi maksimal MAX_HALVING kali:
     jika ll_new > ll_cur atau ll_cur == -Infinity → berhenti
     step *= HALVING; beta_new = beta + step*delta; hitung ulang mu_new, ll_new; stepHalvings++
  jika ll_new < ll_cur dan ll_cur != -Infinity → step = HALVING^MAX_HALVING; hitung ulang
  beta_prev = beta; beta = beta_new; mu = mu_new
  jika iter > 0 dan max|beta - beta_prev| < tol → converged = true; break
  ll_prev = ll_new
LL(mu) = Σ y ln(clamp(mu)) + (1-y) ln(1-clamp(mu))
akhir: w dari mu final (W_MIN), Cov = (Xᵀ W X)⁻¹ TANPA ridge via Cholesky,
       se = sqrt(diag(Cov)), neg2ll = -2·LL(mu final), iterations = iter + 1
```

Default `maxIter = 20` dan `tol = 0.001`, sama dengan `LogisticConfig` produksi
(SPSS BCON = 0.001).

Catatan implementasi:

- **Tanpa nalgebra.** Inti Rust memakai `&[f64]`/`Vec<f64>` row-major, loop
  biasa, dan Cholesky tulisan sendiri (Cholesky–Crout in-place), sama seperti
  versi JS di atas `Float64Array`. Tujuannya agar selisih A/B vs C/D
  mencerminkan runtime (mesin JS vs Wasm), bukan library aljabar.
- **Tanpa alokasi di dalam loop iterasi.** Semua buffer (`beta`, `betaNew`,
  `betaPrev`, `delta`, `g`, `z`, `H`, `mu`, `muNew`, `se`) dialokasikan sekali.
  `mu` dan `muNew` ditukar (*swap*), tidak disalin.
- `mu`, `w`, `g`, dan segitiga atas `H` dihitung dalam satu lintasan per baris;
  `mu_new` dan `LL` saat step-halving juga dihitung dalam satu lintasan. Urutan
  penjumlahan (i naik) sama di kedua bahasa.
- SE dihitung dari `diag((L Lᵀ)⁻¹)_j = ||L⁻¹ e_j||²` lewat substitusi maju.
- Indeks Rust memakai indexing biasa dengan bounds check (tanpa `unsafe`),
  setara dengan akses typed array di JS.

Perbedaan yang **disengaja** terhadap `irls::fit` produksi: tidak ada cek
condition number via SVD dan eskalasi ridge (1e-9 → maks 1e-3), tidak ada
early-stop saat deteksi separasi (|β| > 20 setelah iterasi > maxIter/2),
dan kovarians memakai Cholesky (produksi: `try_inverse`, LU/rumus tertutup,
dengan fallback ridge/pseudo-inverse). Untuk data yang well-conditioned tanpa
separasi, keduanya menghasilkan angka yang sama hingga pembulatan (lihat §7).
Pada data degenerate (kolom nol/konstan, kolinearitas sempurna), inti
eksperimen melempar error `Cholesky gagal…` sementara produksi melanjutkan
dengan regularisasi.

## 4. Persiapan data (di luar waktu ukur)

`services/prepareData.ts` dijalankan sekali di main thread sebelum pengukuran:

1. Variabel dicari ulang di store (id → columnIndex → nama), seperti
   `findActualVariable` produksi.
2. **Listwise deletion**: baris dibuang bila nilai dependen atau kovariat mana
   pun `null`, `undefined`, atau `""` (sama dengan filter `cleanData` di worker produksi).
3. **Kovariat numerik** (ukuran scale/unknown): `Number()`, nilai NaN ditolak
   (cabang non-kategorik `processCovariates`).
4. **Kovariat kategorik**: kovariat berukuran nominal/ordinal otomatis
   diperlakukan kategorik dengan kontras default produksi, **Indicator dengan
   referensi Last** (sama dengan yang ditambahkan dialog produksi ke tab
   Categorical secara otomatis; eksperimen ini tidak punya tab Categorical).
   Dummy coding meniru dua tahap produksi agar kolomnya identik:
   1. worker JS (`processCovariates`): nilai unik diurutkan (numerik bila kedua
      nilai angka, selain itu `localeCompare`); bila semua angka kodenya = nilai
      itu sendiri, bila tidak kodenya = indeks urutan;
   2. Rust (`design_matrix::build`): kode unik diurutkan numerik, kategori
      terakhir = referensi (semua dummy 0), kategori ke-j menjadi kolom
      `nama(j)` bernilai 1.

   Contoh: `grp` ∈ {low, mid, high} → urutan high, low, mid → `grp(1)` = high,
   `grp(2)` = low, referensi mid. Dummy diletakkan di posisi kovariatnya.
   Variabel STRING berukuran scale ditolak (produksi pun gagal mengonversinya);
   kovariat kategorik dengan < 2 kategori setelah listwise deletion ditolak
   (produksi akan memasukkannya sebagai kolom konstan).
5. **Encoding Y**: salinan `processDependentVariable` produksi:
   `[...new Set(rawY)].sort()` (sort **string**, mis. "10" < "9"), nilai pertama → 0,
   kedua → 1, harus tepat 2 level.
6. `X` dibentuk sebagai `Float64Array` row-major n×p dengan kolom intercept
   (semua 1) di depan, lalu kolom kovariat/dummy sesuai urutan (seperti
   `insert_column(0, 1.0)` di `enter.rs`); `y` sebagai `Float64Array` 0/1.
   Dummy coding terjadi di sini, jadi inti IRLS dan pengukurannya tidak berubah.

**Resampling ke ukuran N** (`resample(X, y, n, p, targetN, seed)`): baris
diambil seragam **dengan pengembalian** memakai PRNG mulberry32 ber-seed
(`idx = floor(u · n)`). Bila `targetN = n`, data asli dipakai tanpa resampling.
Seed yang sama memberi dataset yang sama, sehingga keempat mode pada ukuran N
yang sama memproses data identik. Seed batch dipakai langsung untuk setiap N,
sehingga dataset N kecil adalah awalan (*prefix*) dari aliran indeks N besar.

## 5. Metrik

| Metrik | Definisi |
|---|---|
| `computeMs` | Waktu inti IRLS, diukur dengan `performance.now()` di konteks tempat inti dijalankan: main thread (A/C) atau di dalam worker (B/D), tepat mengapit pemanggilan inti. Untuk C/D ini mencakup penyalinan X dan y ke memori linear Wasm dan serialisasi hasil (lihat §8). |
| `wasmCoreMs` | (Tambahan, C/D saja) durasi `irls_core` murni di dalam Wasm, diukur Rust via `performance.now()` yang diimpor; tanpa penyalinan input dan serialisasi hasil. |
| `e2eMs` | Diukur di main thread, dari tepat sebelum dispatch (setelah data siap dan disalin) sampai hasil tersedia di main thread. Worker: dari sebelum `postMessage` sampai awal handler `onmessage` (structured clone hasil sudah terjadi). Main: dispatch = pemanggilan fungsi, sehingga `e2eMs = computeMs`. |
| `overheadMs` | `e2eMs − computeMs`: postMessage, transfer/clone, penjadwalan event loop, dan selisih jam antar konteks. Nol untuk mode main. |
| `spawnMs` | Mode worker **cold**: dari `new Worker()` sampai pesan `ready` diterima di main thread, dikurangi `initMs`. Mencakup pembuatan thread, fetch + evaluasi modul worker (dan `irls_core.js`/glue wasm yang diimpor statis), serta round-trip pesan. |
| `initMs` | Mode worker **cold**: inisialisasi di dalam worker. D: `await init()` (fetch, compile, instantiate `.wasm`); B: ≈ 0 karena tidak ada yang perlu di-init. Untuk worker **warm** keduanya dicatat sekali per batch (`warmSpawnMs*`, `warmInitMs*`). Untuk mode **main** dicatat sekali per page load (`mainJsImportMs`, `mainWasmImportMs`, `mainWasmInitMs`). |
| `maxFrameGapMs` | Jarak maksimum antar callback `requestAnimationFrame` selama run, diukur dengan `performance.now()` **saat callback berjalan** (bukan argumen timestamp rAF, lihat §10). Monitor dimulai pada satu frame baseline sebelum dispatch dan dihentikan satu frame **setelah** hasil tersedia, agar gap yang memuat blocking ikut tercatat. |
| `droppedFrames` | Jumlah gap rAF > 2 × 16,7 ms (33,4 ms). |
| `frameCount` | (Tambahan) jumlah callback rAF yang teramati selama run. |
| `longTaskCount`, `longTaskTotalMs` | Entri `PerformanceObserver({ type: "longtask" })` (task main thread > 50 ms) yang tumpang-tindih dengan jendela run `[dispatch, frame setelah hasil]`. `null` bila browser tidak mendukung (hanya Chromium). |
| `heapUsedMB` | `performance.memory.usedJSHeapSize` main thread setelah run (non-standar, Chromium; bernilai terkuantisasi). Heap worker tidak termasuk. |
| `wasmMemoryMB` | `memory.buffer.byteLength` Wasm setelah run (C: main thread, D: worker). Memori linear tidak pernah menyusut, jadi ini *high-water mark*. |
| `pageHidden` | (Tambahan) `true` bila tab tersembunyi kapan pun selama run; rAF berhenti di tab latar, jadi metrik frame run tersebut tidak valid. |
| `beta`, `se`, `neg2ll`, `iterations`, `converged`, `stepHalvings` | Hasil inti untuk validasi akurasi (kolom `B_<nama>`, `SE_<nama>` di CSV). |

Metadata lingkungan (di setiap baris CSV dan di `meta.json`): `userAgent`,
`hardwareConcurrency`, `deviceMemory`, `crossOriginIsolated`, waktu mulai,
`gitCommit` (dari `NEXT_PUBLIC_GIT_COMMIT` saat build), `buildMode`
(`NODE_ENV`), estimasi interval refresh layar (`refreshIntervalMs`, median gap
rAF saat idle), dan estimasi resolusi `performance.now()` (`timerResolutionMs`,
selisih positif terkecil antar pembacaan).

## 6. Prosedur benchmark

Untuk setiap ukuran N (urut naik):

1. Dataset N dibentuk sekali (`resample`, seed batch).
2. **Warm-up**: `W` ronde (default 5), tidak dicatat. Setiap ronde menjalankan
   keempat mode sekali. Warm-up diulang per N agar JIT/tier-up (V8 TurboFan
   untuk JS, Liftoff → TurboFan untuk Wasm) dan alokator memori berada pada
   kondisi tunak untuk ukuran tersebut.
3. **Ulangan**: `R` ronde (default 30). Pada setiap ronde, **urutan keempat
   mode diacak** dengan Fisher–Yates ber-seed (stream terpisah:
   `mulberry32(hash(seed, N))`) untuk mengurangi bias drift/thermal. Urutan
   tercatat di `meta.json` (`orders`) dan kolom `orderInRep`.
4. Setiap run:
   1. Modul/worker disiapkan (di luar timer). Worker warm dibuat dan di-init sekali
      sebelum batch; dengan opsi *fresh worker per run (cold)* worker baru dibuat
      untuk setiap run dan diakhiri setelahnya.
   2. `X.slice()` dan `y.slice()` dibuat **sebelum** timer untuk semua mode
      (diperlukan sebagai transferable untuk worker; dilakukan juga untuk mode
      main agar perlakuannya sama).
   3. Monitor frame menunggu satu frame baseline, lalu dispatch dari **task
      baru** (MessageChannel) setelah frame baseline selesai dirender. Dispatch
      sengaja tidak dilakukan di dalam callback rAF: di sana hasil worker
      selalu harus menunggu fase render frame itu (uji awal: overhead worker
      ±2,7 ms pada N = 300), padahal di aplikasi nyata komputasi dipicu dari
      task biasa seperti event klik.
   4. Setelah hasil tersedia, monitor menunggu satu frame lagi.
   5. Progress UI diperbarui, lalu **jeda**: dua frame rAF + `setTimeout(50)`.
      Render React terjadi di jeda ini, di luar jendela pengukuran.
   6. Long task untuk jendela run diambil (`takeRecords()` + filter tumpang-tindih).
5. Tombol Cancel menghentikan batch di antara run (run worker yang sedang
   berjalan dibatalkan dan workernya dibuang; run main thread tidak bisa
   diinterupsi dan selesai lebih dulu).

Total run = |N| × (W + R) × 4. Ringkasan per (N, mode): median, IQR (Q1–Q3,
kuantil tipe 7 seperti default R/NumPy), min, dan max untuk `computeMs`,
`e2eMs`, dan `maxFrameGapMs`, plus chart median dengan whisker IQR.

### Penyajian hasil: dialog vs output viewer

- **Dialog (tab Experiment)** adalah tempat utama hasil eksperimen: indikator
  responsivitas, tabel Run once, progress batch, ringkasan median/IQR, chart,
  validasi akurasi, perbandingan produksi, serta unduhan **CSV** (satu baris
  per run) dan **meta.json**. Data untuk analisis artikel diambil dari CSV.
- **Output viewer (tombol OK)** menjalankan analisis lengkap pada konfigurasi
  yang dipilih di tab Experiment (lihat *Tombol OK* di bawah) dan menulis dua
  kartu di bawah satu log:
  1. **"Binary Logistic Regression"**: laporan berkonvensi SPSS yang identik
     dengan modul Binary Logistic produksi (metode Enter, semua opsi default,
     kategorik Indicator/Last). Angkanya dihitung oleh mesin konfigurasi
     terpilih; formatnya dibuat pipeline produksi: formatter
     `formatBinaryLogisticResult`, sintaks `generateLogisticRegressionSyntax`,
     dan pengelompokan komponen yang sama dengan `BinaryLogisticMain.tsx`.
     Catatan kartu menyebut konfigurasinya, mis.
     `Method: Enter · computed with B. JavaScript – Web Worker`.
  2. **"Binary Logistic (Experiment): 2×2 performance"**: tabel performa run OK
     tersebut (*Analysis run (OK)*), lalu, bila ada di sesi dialog itu,
     ringkasan Run once, batch (median [Q1–Q3]), akurasi antar mode, dan
     selisih tiap mode terhadap produksi.

### Tombol OK: analisis lengkap pada konfigurasi terpilih

Run once dan batch hanya menjalankan inti IRLS (B, S.E., −2LL) agar
perbandingan waktunya adil. Tabel SPSS juga butuh Block 0, score test,
omnibus test, pseudo-R², classification table, Wald, dan CI, sehingga tombol OK
menjalankan **analisis Binary Logistic lengkap** (metode Enter, opsi default)
dengan mesin sesuai konfigurasi yang dipilih:

| Mode | Mesin | Tempat |
|---|---|---|
| A | `logistic_enter.js` → `calculateBinaryLogistic` | main thread (`import()`) |
| B | `logistic_enter.js` → `calculateBinaryLogistic` | `jsCore.worker.js` (pesan `init_full` / `run_full`) |
| C | `calculate_binary_logistic` dari `pkg/` eksperimen + `JSON.parse` | main thread |
| D | `calculate_binary_logistic` dari `pkg/` eksperimen + `JSON.parse` | `wasmCore.worker.js` (pesan `init_full` / `run_full`) |

- `calculate_binary_logistic` di paket eksperimen adalah kode Rust produksi
  yang sama (crate yang sama dikompilasi ulang), jadi C/D = analisis produksi.
- `logistic_enter.js` adalah port JavaScript baris demi baris dari jalur
  Enter produksi: `design_matrix::build` (Indicator, referensi Last), Block 0
  (model konstanta, score test per variabel/grup, global), `irls::fit` lengkap
  (cek condition number via SVD + eskalasi ridge, step-halving, deteksi
  separasi + early stop, kovarians `try_inverse` → regularisasi →
  pseudo-inverse, pesan peringatan yang sama), Block 1 (omnibus, Cox & Snell,
  Nagelkerke, classification table cutoff 0,5, Wald, Wald gabungan grup,
  CI 95%), serta fungsi distribusi statrs (`gamma_lr`, `ln_gamma` Lanczos) dan
  bentuk hasil serde (`NaN`/`±Infinity` → `null`). Aljabar liniernya ditulis
  ulang meniru nalgebra (rumus tertutup invers 1–4 dimensi, LU dengan
  partial pivoting, Cholesky); SVD diganti dekomposisi eigen Jacobi, yang
  setara untuk Hessian yang simetris (lihat §10).
- Kedua mesin menerima input yang sama dengan worker produksi: X mentah n×k
  row-major (kode kategori, bukan dummy), y 0/1, `configJson` produksi, dan
  nama kovariat. `model_info` (encoding Y/X, jumlah kasus, nama variabel)
  ditambahkan di main thread seperti worker produksi, di luar timer.
- Aturan pengukuran sama dengan run inti (§6.4): mesin dimuat/worker
  disiapkan dan buffer disalin **sebelum** timer, dispatch dari task baru,
  monitor frame dan long task di jendela yang sama. Opsi *fresh worker per
  run (cold)* juga berlaku untuk OK.

Metrik pada kartu *Analysis run (OK)*:

| Metrik | Definisi |
|---|---|
| `computeMs` | Analisis lengkap, diukur di konteks tempat mesin berjalan. C/D mencakup penyalinan input ke memori Wasm, serialisasi `serde_json` di Rust, dan `JSON.parse` di JS (string JSON adalah antarmuka produksi). A/B mengembalikan objek JS langsung. |
| `e2eMs`, `overheadMs` | Seperti §5; untuk B/D `overheadMs` memuat structured clone objek hasil lengkap (jauh lebih besar daripada hasil inti). |
| `engineInitMs` | Pemuatan mesin sebelum timer: `import()` `logistic_enter.js` (A, B di dalam worker) atau `init()` wasm (C, D). ≈ 0 bila sudah dimuat sebelumnya di halaman/worker itu. |
| `spawnMs`, `initMs` | Hanya bila run OK ini membuat worker baru (cold, atau worker warm pertama di dialog). |
| `maxFrameGapMs`, `droppedFrames`, `longTasks`, `heapUsedMB`, `wasmMemoryMB` | Seperti §5. |
| `formatMs` | `formatBinaryLogisticResult` produksi di main thread (sama untuk keempat mode, di luar `e2eMs`). |
| `saveMs` | Penulisan log + tabel SPSS ke store hasil (IndexedDB), di luar `e2eMs`. |

Satu klik OK adalah **satu run tanpa warm-up**: berguna untuk demonstrasi dan
untuk memastikan keempat konfigurasi menghasilkan laporan yang sama, bukan
untuk inferensi. Data artikel tetap diambil dari batch (CSV).

## 7. Validasi akurasi

| Tingkat | Pembanding | Hasil verifikasi |
|---|---|---|
| Unit test JS | Golden values bersama (`rust/src/bench/testdata/irls_core_cases.json`), solusi tertutup tabel 2×2, gradien skor ≈ 0, kasus step-halving, batas iterasi, kegagalan Cholesky | lulus (Jest) |
| Unit test Rust | Golden values yang sama (toleransi 1e-10), solusi tertutup 2×2, `irls::fit` produksi (toleransi 1e-8) | lulus; selisih aktual ≤ 1,4e-14 vs golden JS dan ≤ 3,6e-15 vs `irls::fit` |
| Biner wasm | Golden values via Node (`initSync`) | identik bit-per-bit (Δ = 0) |
| Antar mode (UI) | Per N: max \|Δβ\| dan max \|ΔSE\| tiap mode terhadap run pertama mode D, atas semua ulangan | kriteria < 1e-8 |
| Terhadap produksi (UI) | Tombol *Compare with production*: `calculate_binary_logistic` (Enter, opsi default, kategorik Indicator/Last) lewat worker produksi pada data N asli; baris "Constant" ↔ kolom intercept, kovariat dan dummy (`nama(j)`) dicocokkan lewat nama, baris omnibus grup kategorik dilewati | kriteria < 1e-4 |
| Port JS analisis lengkap | `scripts/checkEnterParity.mjs` (juga dijalankan Jest lewat `logisticEnterParity.experiment.test.js`): seluruh objek hasil `logistic_enter.js` vs `calculate_binary_logistic` Rust (paket eksperimen via `initSync`) pada 7 dataset: numerik, kategorik, step-halving + separasi, hampir separasi, kolinear sempurna, kolom nol, kategorik kecil. Semua field dibandingkan, termasuk pesan peringatan | lulus; selisih berskala maks 7,3e-14 (kriteria \|Δ\| ≤ 1e-8 · max(1, \|a\|, \|b\|)) |
| Output viewer (E2E) | Tombol OK di keempat konfigurasi (D, A, B, C) vs dialog Binary Logistic produksi untuk data dan variabel yang sama | header komponen, isi tabel, dan sintaks identik untuk keempat mode |

Kasus step-halving di golden test dipilih dengan sengaja: semua perbandingan
log-likelihood pada kasus itu jauh di atas noise pembulatan (penurunan LL 0,55%
pada langkah penuh). Kasus ketika MLE ≈ 0 justru dihindari, karena di sana
`ll_new > ll_cur` hanya berbeda di tingkat noise (lihat §8).

## 8. Build wasm

Prasyarat (tercatat saat implementasi): `rustc 1.91.1`, `cargo 1.91.1`,
`wasm-pack 0.13.1`, target `wasm32-unknown-unknown`, wasm-bindgen 0.2.129
(CLI diunduh otomatis oleh wasm-pack), serde-wasm-bindgen 0.4.5, wasm-opt
(binaryen) version 117. `Cargo.lock` tidak di-commit (di-ignore repo), jadi
build ulang dapat me-resolve versi patch dependensi yang lebih baru; catat
versi yang dipakai saat benchmark.

```powershell
cd frontend
npm run build:wasm:experiment
```

Script tersebut menjalankan `wasm-pack build --target web --release --out-dir target/experiment-pkg`
di crate `BinaryLogistic/rust` (profil release default: `opt-level = 3`, tanpa
LTO, lalu `wasm-opt -O`), kemudian menyalin `statify_logistic*` ke
`public/workers/Regression/BinaryExperiment/pkg/`. `rust/pkg` dan
`public/workers/Regression/Binary/pkg` produksi tidak disentuh. Paket
eksperimen memuat seluruh crate (termasuk fungsi produksi), sehingga ukuran
`.wasm` (~755 KB) dan biaya `init()` sebanding dengan paket produksi.

Unit test:

```powershell
cd frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust
cargo test
cd ../../../../../..   # kembali ke frontend
npx jest __tests__/irlsCore.experiment.test.js __tests__/binaryLogisticExperiment __tests__/logisticEnterParity.experiment.test.js
```

Paritas port JS vs Rust juga bisa dijalankan langsung (dari folder `frontend`,
butuh paket `pkg/` hasil build wasm):
`node components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/checkEnterParity.mjs`.
Bila jalur Enter produksi di Rust berubah, `logistic_enter.js` harus ikut
diperbarui; skrip ini akan gagal bila keduanya tidak lagi sama.

Bila algoritma sengaja diubah di **kedua** inti, buat ulang golden values:
`node components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/genIrlsFixtures.mjs`
(dari folder `frontend`).

## 9. Panduan menjalankan benchmark dengan benar

1. **Wajib production build.** `next dev` memakai React development mode,
   source map, dan HMR sehingga angka tidak representatif (dialog menampilkan
   peringatan bila bukan production build; kolom `buildMode` di CSV harus
   `production`).

   ```powershell
   cd frontend
   $env:NEXT_PUBLIC_GIT_COMMIT = (git rev-parse --short HEAD)
   npm run build
   npm run start        # next start -p 3001 → http://localhost:3001
   ```

   (`npm run build:experiment` melakukan dua baris pertama sekaligus.)
2. Satu browser saja (disarankan Chrome/Edge versi stabil terbaru) dan **catat
   versinya** (juga tercatat di `userAgent`). `longtask` dan `performance.memory`
   hanya tersedia di Chromium.
3. Tutup tab dan aplikasi lain; matikan ekstensi (atau pakai profil bersih /
   jendela InPrivate tanpa ekstensi).
4. Laptop **dicolok charger**, mode daya Windows *Best performance*, matikan
   battery saver; biarkan mesin idle beberapa menit sebelum mulai.
5. Muat dataset, pilih variabel, lalu **reload halaman** sebelum batch final
   agar `mainJsImportMs`/`mainWasmInitMs` (cold per page load) bersih.
6. Biarkan tab **tetap terlihat** dan jangan berinteraksi selama batch: rAF
   berhenti di tab latar (run seperti ini ditandai `pageHidden = true`).
7. Pengaturan baku: warm-up 5, ulangan 30, seed dicatat, ukuran N asli +
   10.000 + 50.000 + 100.000. Ulangi batch dengan opsi *cold* bila ingin
   mengukur biaya pembuatan worker.
8. Unduh **CSV** (satu baris per run) dan **meta.json** setelah setiap batch.
   Pastikan tabel akurasi lulus (< 1e-8) dan *Compare with production* lulus (< 1e-4).
   Pilih konfigurasi lalu klik **OK** untuk menjalankan analisis lengkap pada
   konfigurasi itu dan menyimpan laporan SPSS + kartu performa (dan ringkasan
   batch) ke output viewer (lihat §6, *Tombol OK*).
9. Untuk rekaman demo freeze: pilih mode A atau C, N = 100.000, lalu *Run once*.
   Indikator responsivitas (bar + FPS) digerakkan rAF di main thread, jadi bar
   berhenti selama inti berjalan; ulangi dengan B/D untuk pembanding.

## 10. Keterbatasan

- **Resolusi timer.** `performance.now()` dibatasi browser. Dengan header
  COOP/COEP (aktif di `next.config.js`, `crossOriginIsolated = true`)
  Chromium memberi ~5 µs (dengan jitter), tanpa isolasi ~100 µs; Firefox lebih
  kasar. Resolusi efektif tercatat di `timerResolutionMs`. Untuk N kecil,
  `computeMs` bisa berada di orde resolusi timer.
- **Jam berbeda konteks.** `computeMs` worker diukur dengan jam worker, `e2eMs`
  dengan jam main thread; yang dikirim antar thread hanya durasi (bukan
  timestamp), tetapi `overheadMs` tetap selisih dua jam yang berbeda.
- **Biaya boundary di C/D.** `computeMs` mode C/D mencakup `malloc` + penyalinan
  X dan y ke memori linear Wasm (`passArrayF64ToWasm0`) dan serialisasi hasil
  (serde-wasm-bindgen, ~2p angka). Mode A/B membaca `Float64Array` langsung
  tanpa penyalinan. `wasmCoreMs` disediakan untuk memisahkan inti murni.
- **Bentuk hasil.** A/B mengembalikan `Float64Array`, C/D `Array`; structured
  clone hasil ke main thread sangat kecil (2p angka) untuk keduanya.
- **Fungsi elementer berbeda.** `Math.exp`/`Math.log` V8 (port fdlibm) dan
  `f64::exp`/`ln` Rust di wasm32 (libm, turunan musl) dapat berbeda 1 ULP
  pada sebagian input. Dalam semua uji (fixture, data sintetis n = 20.000,
  dataset E2E) keempat mode identik bit-per-bit, tetapi kesamaan bit tidak
  dijamin. Risiko terbesar ada pada kasus ketika langkah Newton terakhir
  sangat kecil (mis. MLE ≈ 0, efek nyaris nol) sehingga keputusan
  step-halving `ll_new > ll_cur` hanya berbeda di tingkat noise; di sana
  selisih antar teknologi bisa membesar hingga orde langkah terakhir.
  Kolom `stepHalvings` per mode membantu mendiagnosis kasus ini.
- **Long task** hanya didukung Chromium, dengan ambang tetap 50 ms dan atribusi
  kasar (task, bukan fungsi). Entri dikirim asinkron sehingga diambil setelah jeda.
- **Frame timing.** Gap dihitung dari `performance.now()` saat callback rAF
  berjalan, sehingga gap normal sedikit berfluktuasi di sekitar interval
  refresh (jitter penjadwalan). Argumen timestamp rAF sengaja tidak dipakai:
  di Chromium nilainya adalah waktu BeginFrame yang selaras vsync dan bisa
  terbit saat main thread masih macet, sehingga gap terkuantisasi ke kelipatan
  16,7 ms dan meremehkan freeze (uji awal: inti 62 ms → gap timestamp 50,0 ms).
  Ambang frame drop tetap 2 × 16,7 ms walau layar 90/120 Hz (lihat
  `refreshIntervalMs`). Untuk mode main, `maxFrameGapMs` ≳ `computeMs` karena
  callback berikutnya baru bisa berjalan setelah inti selesai.
- **`performance.memory`** non-standar, terkuantisasi, dan hanya mencakup heap
  JS main thread; heap worker tidak terukur.
- **Non-determinisme runtime.** GC, tier-up JIT, throttling thermal, dan
  penjadwalan OS menambah varians. Pengacakan urutan per ulangan mengurangi
  bias sistematis antar mode, tetapi ukuran N dijalankan berurutan (naik), jadi
  drift jangka panjang dapat bercampur dengan efek N.
- **Resampling dengan pengembalian** mempertahankan distribusi data asli tetapi
  menghasilkan baris duplikat; jumlah iterasi IRLS bisa berbeda antar N
  (tercatat di kolom `iterations`).
- **Waktu tombol OK bukan kontras bersih.** Pada OK, A/B menjalankan port JS
  dan C/D kode Rust produksi. Algoritma dan urutan langkahnya sama dan hasilnya
  identik hingga pembulatan, tetapi implementasi aljabar liniernya tidak
  identik baris demi baris seperti `irls_core` (mis. condition number: eigen
  Jacobi Hessian di JS vs SVD nalgebra di Rust; nalgebra juga memakai struktur
  data dan alokasi sendiri). C/D juga membayar serialisasi JSON dua arah
  (`serde_json` → string → `JSON.parse`), sedangkan A/B tidak. Karena itu
  selisih waktu OK mencampur efek runtime dengan efek implementasi; kontras
  teknologi × lokasi yang bersih tetap berasal dari Run once/batch.
- **Validitas eksternal.** Hasil berlaku untuk satu browser/mesin per batch;
  mesin JS dan Wasm lain (SpiderMonkey, JavaScriptCore) dapat berperilaku
  berbeda. Inti eksperimen sengaja lebih sederhana dari `irls::fit` produksi
  (§3), dan Wasm dijalankan single-thread tanpa SIMD.
