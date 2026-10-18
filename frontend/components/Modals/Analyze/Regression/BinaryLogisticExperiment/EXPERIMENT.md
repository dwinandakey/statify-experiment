# Strategi eksekusi untuk komputasi statistik di browser: WebAssembly, Web Worker, dan siklus hidup worker pada regresi logistik biner

Dokumen ini menjelaskan desain, implementasi, metrik, prosedur, dan keterbatasan
menu **Analyze → Regression → Binary Logistic (Experiment)**. Isinya disusun
sebagai bahan bagian *Method* artikel *Execution Strategies for Client-Side
Statistical Computing: A Factorial Case Study of WebAssembly, Web Workers, and
Worker Lifecycle in Logistic Regression*. Data, skrip analisis, dan langkah
reproduksi tabel dan gambar artikel ada di `reproducibility/REPRODUCE.md` (root repo).

## 1. Tujuan

Memisahkan kontribusi tiga keputusan strategi eksekusi terhadap kinerja dan
responsivitas komputasi statistik di browser, dengan regresi logistik biner
(IRLS) sebagai beban kerja:

1. **Teknologi komputasi**: JavaScript (JIT V8) vs Rust yang dikompilasi ke WebAssembly.
2. **Lokasi eksekusi**: main thread (UI thread) vs Web Worker (thread terpisah).
3. **Siklus hidup worker** (hanya bila lokasinya worker): **persistent**, satu
   worker dibuat sekali lalu dipakai ulang untuk setiap run, vs **per-run**,
   worker baru untuk setiap run yang diakhiri setelah run selesai.

Statify produksi memakai konfigurasi D (Wasm di worker). Eksperimen ini
menjalankan keempat konfigurasi A–D, pada workload *IRLS core* dengan inti
algoritma yang identik di kedua bahasa (perbedaan terukur berasal dari runtime
dan lokasi eksekusi, bukan dari algoritma atau library aljabar) dan pada workload
*full analysis* yang memakai jalur analisis lengkap (§6).

## 2. Desain faktorial

| Kode | Teknologi | Lokasi | Kode yang dijalankan |
|---|---|---|---|
| A | JavaScript | Main thread | `irls_core.js` via `import()` di main thread |
| B | JavaScript | Web Worker | `irls_core.js` via `jsCore.worker.js` |
| C | Rust-WebAssembly | Main thread | `pkg/statify_logistic.js` → `irls_core_bench` di main thread |
| D | Rust-WebAssembly | Web Worker | `pkg/statify_logistic.js` → `irls_core_bench` via `wasmCore.worker.js` |

Siklus hidup worker adalah faktor **bersarang** di dalam lokasi worker: hanya
berlaku untuk B dan D, jadi desainnya bukan 2×2×2. Desainnya adalah faktorial
teknologi × lokasi (konfigurasi A–D), dengan dua tingkat siklus hidup untuk B dan D:

| Siklus hidup | Di dialog | Di data (CSV, meta.json) | Biaya pembuatan worker |
|---|---|---|---|
| persistent | *Fresh worker per run (cold)* tidak dicentang | `workerStart = warm`, `coldWorkers = false` | sekali sebelum batch, di luar run (`warmSpawnMs*`, `warmInitMs*`, `warmEngineInitMs*` di meta) |
| per-run | dicentang | `workerStart = cold`, `coldWorkers = true` | setiap run, sebelum timer (`spawnMs`, `initMs`, `engineInitMs` per baris) |

Untuk A dan C pengaturan ini tidak berpengaruh karena tidak ada worker. Artikel
memakai empat batch: IRLS core dan full analysis, masing-masing dengan worker
persistent dan per-run (§9).

Kontras yang bisa diestimasi dari data per run (CSV):

- Efek utama teknologi: (A + B) vs (C + D).
- Efek utama lokasi: (A + C) vs (B + D).
- Interaksi: (A − B) − (C − D), yaitu apakah biaya memindahkan kerja ke worker
  berbeda untuk JS dan Wasm.
- Efek siklus hidup, per worker (B, D): per-run vs persistent, yaitu biaya
  start-up (`spawnMs + initMs + engineInitMs`) dan penalti komputasi pada worker
  yang baru dibuat.

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
| `tests/experiment/` | E2E Playwright (config terpisah + fixture CSV) dan runner benchmark `benchmark-workloads.spec.ts` |
| `reproducibility/` | Data keempat batch artikel, skrip analisis (tabel dan gambar), `REPRODUCE.md` |

Modul Binary Logistic produksi, worker produksi, dan paket wasm produksi
(`public/workers/Regression/Binary/pkg`) tidak diubah. Crate Rust produksi hanya
ditambah modul `bench` (ekspor `irls_core_bench`, `calculate_binary_logistic_timed`,
`last_full_timings`) serta `Cargo.lock` dan `rust-toolchain.toml` untuk mengunci
build (§8); keduanya juga berlaku untuk build produksi dari crate yang sama.

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
| `wasmCoreMs` | (Tambahan, C/D saja) durasi di dalam Wasm, diukur Rust via `performance.now()` yang diimpor; tanpa penyalinan input dan serialisasi hasil. Workload *core*: `irls_core` murni. Workload *full*: analisis Enter (parsing config, design matrix, seluruh statistik) dari `calculate_binary_logistic_timed` (§6, *Tombol OK*). |
| `wasmSerializeMs` | (Workload *full*, C/D) `serde_json::to_string` atas hasil, di dalam Wasm. Sisa `computeMs − wasmCoreMs − wasmSerializeMs` = boundary JS↔Wasm (salin-masuk X/y, string JSON ke JS, `JSON.parse`). |
| `e2eMs` | Diukur di main thread, dari tepat sebelum dispatch (setelah data siap dan disalin) sampai hasil tersedia di main thread. Worker: dari sebelum `postMessage` sampai awal handler `onmessage` (structured clone hasil sudah terjadi). Main: dispatch = pemanggilan fungsi, sehingga `e2eMs = computeMs`. |
| `overheadMs` | `e2eMs − computeMs`: postMessage, transfer/clone, penjadwalan event loop, dan selisih jam antar konteks. Nol untuk mode main. |
| `spawnMs` | Worker **per-run** (cold): dari `new Worker()` sampai pesan `ready` diterima di main thread, dikurangi `initMs`. Mencakup pembuatan thread, fetch + evaluasi modul worker (dan `irls_core.js`/glue wasm yang diimpor statis), serta round-trip pesan. |
| `initMs` | Worker **per-run** (cold): inisialisasi di dalam worker. D: `await init()` (fetch, compile, instantiate `.wasm`); B: ≈ 0 karena tidak ada yang perlu di-init. Untuk worker **persistent** (warm) keduanya dicatat sekali per batch (`warmSpawnMs*`, `warmInitMs*`). Untuk mode **main** dicatat sekali per page load (`mainJsImportMs`, `mainWasmImportMs`, `mainWasmInitMs`). |
| `maxFrameGapMs` | Jarak maksimum antar callback `requestAnimationFrame` selama run, diukur dengan `performance.now()` **saat callback berjalan** (bukan argumen timestamp rAF, lihat §10). Monitor dimulai pada satu frame baseline sebelum dispatch dan dihentikan satu frame **setelah** hasil tersedia, agar gap yang memuat blocking ikut tercatat. |
| `droppedFrames` | Perkiraan jumlah **frame yang terlewat**: Σ max(0, round(gap / T) − 1) atas semua gap rAF di jendela run, T = `frameIntervalMs`. Satu gap 255 ms pada 60 Hz dihitung 14 frame, bukan 1. |
| `longGapCount` | Jumlah **gap** rAF > 2T (jumlah gap, bukan jumlah frame). Ini definisi `droppedFrames` versi awal; dipertahankan untuk kesinambungan. |
| `frameIntervalMs` | T: interval refresh layar, diukur sekali per sesi saat idle (median gap rAF; batch memakai `refreshIntervalMs` dari awal batch). Bila di luar 4–50 ms dipakai 1000/60 ms. |
| `frameCount` | (Tambahan) jumlah callback rAF yang teramati selama run. |
| `longTaskCount`, `longTaskTotalMs` | Entri `PerformanceObserver({ type: "longtask" })` (task main thread > 50 ms) yang tumpang-tindih dengan jendela run `[dispatch, frame setelah hasil]`. `null` bila browser tidak mendukung (hanya Chromium). |
| `mainHeapUsedMB` | `performance.memory.usedJSHeapSize` **main thread** setelah run (non-standar, Chromium; terkuantisasi). `performance.memory` tidak tersedia di worker (dicek di Chrome 155), jadi memori worker B/D tidak terukur sama sekali: **jangan bandingkan metrik ini antarlokasi** (main vs worker). Untuk D, memori linear Wasm di worker terlihat di `wasmMemoryMB`. |
| `wasmMemoryMB` | `memory.buffer.byteLength` Wasm setelah run (C: main thread, D: worker). Memori linear tidak pernah menyusut, jadi ini *high-water mark*. |
| `pageHidden` | (Tambahan) `true` bila tab tersembunyi kapan pun selama run; rAF berhenti di tab latar, jadi metrik frame run tersebut tidak valid. |
| `beta`, `se`, `neg2ll`, `iterations`, `converged`, `stepHalvings` | Hasil inti untuk validasi akurasi (kolom `B_<nama>`, `SE_<nama>` di CSV). Untuk workload *full*, B dan S.E. diambil dari tabel *Variables in the Equation* dan `stepHalvings` dari `fitting_warnings.step_halving_count` fit model akhir (0 bila objek itu tidak ada), sama untuk port JS dan Rust. |
| `workload` | `core` (inti IRLS) atau `full` (analisis lengkap + tabel SPSS, §6 *Batch workload Full analysis*). |
| `formatMs` | (Workload *full*) formatter SPSS produksi di main thread setelah hasil tersedia, termasuk penambahan `model_info`; di dalam jendela ukur, di luar `e2eMs`. |
| `totalMs` | (Workload *full*) dispatch → tabel SPSS selesai diformat, kira-kira `e2eMs + formatMs`: waktu sampai laporan siap ditulis. |
| `engineInitMs` | (Workload *full*) pemuatan mesin analisis lengkap sebelum timer: `logistic_enter.js` (A, B) atau `init()` wasm (C, D); ≈ 0 bila sudah dimuat. Untuk worker persistent dicatat sekali per batch (`warmEngineInitMs*`). |
| `tablesHash`, `tablesIdenticalToD` | (Workload *full*) hash cyrb53 isi tabel SPSS run itu, dan apakah sama dengan run sukses pertama mode D pada N yang sama. |

Metadata lingkungan (di setiap baris CSV dan di `meta.json`): `userAgent`,
`hardwareConcurrency`, `deviceMemory`, `crossOriginIsolated`, waktu mulai,
`gitCommit` (dari `NEXT_PUBLIC_GIT_COMMIT` saat build; `npm run build:experiment`
mengisinya dari HEAD, §9), `buildMode`
(`NODE_ENV`), estimasi interval refresh layar (`refreshIntervalMs`, median gap
rAF saat idle), dan estimasi resolusi `performance.now()` (`timerResolutionMs`,
selisih positif terkecil antar pembacaan).

## 6. Prosedur benchmark

Batch punya dua **workload** (pilihan *Workload* di bagian batch):

- **IRLS core** (default): inti IRLS yang identik baris demi baris di JS dan
  Rust (loop biasa di atas array, Cholesky tulisan sendiri). Ini
  **perbandingan runtime murni**: selisih JS vs Wasm berasal dari mesin
  eksekusinya, bukan dari kode.
- **Full analysis + SPSS tables**: pipeline tombol OK di setiap run (lihat
  *Batch workload Full analysis* di bawah). Ini **skenario aplikasi nyata**,
  tetapi membandingkan *implementasi* sekaligus runtime: A/B menjalankan port
  JS dengan loop terfusi, C/D jalur produksi berbasis nalgebra (lihat
  *Membaca core vs full*).

Hasil batch terakhir per workload disimpan terpisah di dialog; keduanya ikut
ditulis tombol OK. Prosedur berikut sama untuk kedua workload. Untuk setiap
ukuran N (urut naik):

1. Dataset N dibentuk sekali (`resample`, seed batch). Workload *full* memakai
   `resampleFull` pada kovariat mentah dengan seed yang sama, sehingga indeks
   barisnya identik dengan dataset workload *core*.
2. **Warm-up**: `W` ronde (default 5), tidak dicatat. Setiap ronde menjalankan
   keempat mode sekali. Warm-up diulang per N agar JIT/tier-up (V8 TurboFan
   untuk JS, Liftoff → TurboFan untuk Wasm) dan alokator memori berada pada
   kondisi tunak untuk ukuran tersebut.
3. **Ulangan**: `R` ronde (default 30). Pada setiap ronde, **urutan keempat
   mode diacak** dengan Fisher–Yates ber-seed (stream terpisah:
   `mulberry32(hash(seed, N))`) untuk mengurangi bias drift/thermal. Urutan
   tercatat di `meta.json` (`orders`) dan kolom `orderInRep`.
4. Setiap run:
   1. Modul/worker disiapkan (di luar timer). Worker persistent dibuat dan di-init
      sekali sebelum batch. Dengan siklus hidup per-run (centang *Fresh worker per
      run (cold)*), worker baru dibuat dan di-init untuk setiap run sebelum timer,
      lalu diakhiri setelah run.
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
`e2eMs`, dan `maxFrameGapMs` (workload *full*: juga `formatMs` dan `totalMs`),
plus chart median dengan whisker IQR.

### Membaca core vs full

Jalur produksi Rust (`stats/irls.rs`, `fit`) di setiap iterasi IRLS membuat
dua salinan transpose X (`x.transpose() * &residuals` untuk gradien dan
`let mut xt_w = x.transpose()` untuk XᵀWX; masing-masing p×n, ±9,6 MB pada
N = 100.000, p = 12), lalu perkalian matriks generik nalgebra, dan mengecek
condition number Hessian dengan SVD (`estimate_condition_number`). Hasilnya
diserialisasi ke JSON. Port JS menghitung gradien dan XᵀWX langsung dalam satu
lintasan per baris tanpa salinan, dan condition number dari eigen Jacobi.
Salinan transpose dan perkalian matriks berskala n·p, jadi ikut menentukan
**biaya per baris**; SVD p×p dan serialisasi JSON tidak bergantung pada N.

Karena itu jalankan **kedua workload dengan pengaturan dan dataset yang sama**
(runner otomatis: §9) dan bandingkan biaya per baris (slope `computeMs` ~ N)
dan rasio Wasm/JS per lokasi (`scripts/compareWorkloads.mjs`):

- Wasm tetap unggul di *core* pada N besar, tetapi tidak di *full* → biaya
  tambahan di *full* berasal dari implementasi (jalur nalgebra), bukan dari
  runtime Wasm.
- Wasm juga tidak unggul di *core* → V8 memang setara untuk beban ini.

Keduanya dilaporkan: *core* untuk perbandingan runtime murni, *full* untuk
skenario aplikasi nyata. Pada C/D, `wasmCoreMs` dan `wasmSerializeMs` memisahkan
analisis di dalam Wasm dari serialisasi dan boundary JS↔Wasm.

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
     `Method: Enter · computed with B. JavaScript – Web Worker`. Kartu ini
     bisa dimatikan dengan kotak *Include the SPSS tables when pressing OK*
     (OK lalu hanya menulis laporan performa).
  2. **"Binary Logistic (Experiment): 2×2 performance"** (nama kartu di aplikasi): tabel
     *Analysis run performance – \<konfigurasi\>* untuk run OK tersebut, lalu,
     bila ada, ringkasan Run once, batch *IRLS core*, batch *full analysis*
     (median [Q1–Q3] dan akurasi antar mode, termasuk jumlah run yang tabel
     SPSS-nya identik dengan mode D), dan selisih tiap mode terhadap produksi.
- **Dialog tetap terbuka setelah OK** (berbeda dengan dialog produksi), jadi
  OK bisa diulang dengan konfigurasi lain; status di footer menghitung output
  yang sudah ditulis dan app berpindah ke halaman Result di panel utama.
- **Memori dialog.** Pilihan variabel, konfigurasi, pengaturan batch, hasil
  Run once/batch/perbandingan, dan status OK diingat selama halaman belum
  di-reload, juga saat dialog ditutup atau tertimpa dialog lain
  (`hooks/useDialogMemory.ts`). Memori dikosongkan bila dataset berganti
  (jumlah baris atau daftar variabel berbeda). Reload halaman memulai dari awal.

### Tombol OK: analisis lengkap pada konfigurasi terpilih

Run once dan batch *IRLS core* hanya menjalankan inti IRLS (B, S.E., −2LL)
agar perbandingan waktunya adil. Tabel SPSS juga butuh Block 0, score test,
omnibus test, pseudo-R², classification table, Wald, dan CI, sehingga tombol OK
(dan batch workload *full*) menjalankan **analisis Binary Logistic lengkap**
(metode Enter, opsi default) dengan mesin sesuai konfigurasi yang dipilih:

| Mode | Mesin | Tempat |
|---|---|---|
| A | `logistic_enter.js` → `calculateBinaryLogistic` | main thread (`import()`) |
| B | `logistic_enter.js` → `calculateBinaryLogistic` | `jsCore.worker.js` (pesan `init_full` / `run_full`) |
| C | `calculate_binary_logistic_timed` dari `pkg/` eksperimen + `JSON.parse` | main thread |
| D | `calculate_binary_logistic_timed` dari `pkg/` eksperimen + `JSON.parse` | `wasmCore.worker.js` (pesan `init_full` / `run_full`) |

- `calculate_binary_logistic_timed` (`rust/src/bench/enter_timed.rs`, modul
  baru) memanggil fungsi internal produksi yang sama dengan
  `calculate_binary_logistic` (`design_matrix::build`, `strategies::enter::run`,
  `serde_json::to_string`) dengan validasi dan pesan error yang sama, jadi
  C/D = analisis produksi. Bedanya hanya pencatatan waktu di dalam Wasm
  (analisis vs serialisasi), dibaca setelah timer JS berhenti lewat
  `last_full_timings()`. String JSON-nya identik byte demi byte dengan
  `calculate_binary_logistic` (dicek `checkEnterParity.mjs` pada 7 dataset);
  fungsi produksi tidak diubah.
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
  nama kovariat.
- Setelah hasil tersedia di main thread, `model_info` (encoding Y/X, jumlah
  kasus, nama variabel) ditambahkan seperti worker produksi dan tabel SPSS
  dibentuk dengan formatter produksi (`services/spssFormat.ts`), untuk keempat
  mode di main thread seperti `handleAnalyze` produksi. Langkah ini masih di
  dalam jendela ukur (`formatMs`, `totalMs`), sehingga gap frame juga
  mencakup pembentukan tabel.
- Aturan pengukuran lain sama dengan run inti (§6.4): mesin dimuat/worker
  disiapkan dan buffer disalin **sebelum** timer, dispatch dari task baru,
  monitor frame dan long task di jendela yang sama. Opsi *fresh worker per
  run (cold)* juga berlaku untuk OK.

Metrik pada kartu *Analysis run (OK)*:

| Metrik | Definisi |
|---|---|
| `computeMs` | Analisis lengkap, diukur di konteks tempat mesin berjalan. C/D mencakup penyalinan input ke memori Wasm, serialisasi `serde_json` di Rust, dan `JSON.parse` di JS (string JSON adalah antarmuka produksi). A/B mengembalikan objek JS langsung. |
| `wasmCoreMs`, `wasmSerializeMs` | (C/D) analisis dan serialisasi JSON di dalam Wasm; lihat §5. |
| `stepHalvings` | Step-halving fit model akhir (`fitting_warnings.step_halving_count`, 0 bila tidak ada). |
| `e2eMs`, `overheadMs` | Seperti §5; untuk B/D `overheadMs` memuat structured clone objek hasil lengkap (jauh lebih besar daripada hasil inti). |
| `engineInitMs` | Pemuatan mesin sebelum timer: `import()` `logistic_enter.js` (A, B di dalam worker) atau `init()` wasm (C, D). ≈ 0 bila sudah dimuat sebelumnya di halaman/worker itu. |
| `spawnMs`, `initMs` | Hanya bila run OK ini membuat worker baru (per-run, atau worker persistent pertama di dialog). |
| `maxFrameGapMs`, `droppedFrames`, `longGapCount`, `longTasks`, `mainHeapUsedMB`, `wasmMemoryMB` | Seperti §5 (`mainHeapUsedMB` hanya main thread; jangan dibandingkan antarlokasi). |
| `formatMs` | `formatBinaryLogisticResult` produksi di main thread (sama untuk keempat mode); di dalam jendela ukur, di luar `e2eMs`. |
| `totalMs` | Dispatch → tabel SPSS selesai diformat. |
| `saveMs` | Penulisan tabel SPSS ke store hasil (IndexedDB), di luar jendela ukur; tidak ada bila tabel SPSS tidak ditulis. |

Satu klik OK adalah **satu run tanpa warm-up**: berguna untuk demonstrasi dan
untuk memastikan keempat konfigurasi menghasilkan laporan yang sama, bukan
untuk inferensi. Untuk mengukur pipeline OK secara berulang, pakai batch
workload *full* di bawah.

### Batch workload *Full analysis*

Batch dengan workload **Full analysis + SPSS tables** menjalankan pipeline
tombol OK di setiap run, dengan prosedur batch yang sama (warm-up, ulangan,
urutan mode acak, jeda antar run, siklus hidup persistent atau per-run):

1. Mesin analisis lengkap per mode (tabel di atas) menghitung hasil.
2. Tabel SPSS dibentuk dengan formatter produksi di main thread, di dalam
   jendela ukur (`formatMs`, `totalMs`).
3. Di luar jendela ukur, isi tabel di-hash (cyrb53 dari JSON section) lalu
   tabelnya dibuang. **Tidak ada yang ditulis ke output viewer selama batch**,
   jadi batch tidak menghasilkan ratusan laporan SPSS.

Validasi per N: B dan S.E. dari tabel *Variables in the Equation* dibandingkan
dengan run sukses pertama mode D (selisih absolut dan berskala
\|Δ\| / max(1, \|nilai\|)), dan hash tabel SPSS setiap run dibandingkan dengan
hash run acuan itu (kolom *SPSS tables* di dialog, `tablesIdenticalToD` di
CSV). Lulus bila semua tabel identik dan selisih berskala < 1e-8.

Worker persistent memuat mesinnya sekali sebelum batch (`warmEngineInitMsB/D` di
CSV). Klik **OK** setelah batch untuk menulis ringkasan dan akurasinya ke
kartu eksperimen; data per run tetap lewat **Download CSV**. Waktu workload
*full* membandingkan port JS dengan kode Rust produksi, jadi bukan kontras
teknologi yang bersih: laporkan bersama batch *core* dengan pengaturan yang
sama (lihat *Membaca core vs full* dan §10).

## 7. Validasi akurasi

| Tingkat | Pembanding | Hasil verifikasi |
|---|---|---|
| Unit test JS | Golden values bersama (`rust/src/bench/testdata/irls_core_cases.json`), solusi tertutup tabel 2×2, gradien skor ≈ 0, kasus step-halving, batas iterasi, kegagalan Cholesky | lulus (Jest) |
| Unit test Rust | Golden values yang sama (toleransi 1e-10), solusi tertutup 2×2, `irls::fit` produksi (toleransi 1e-8) | lulus; selisih aktual ≤ 1,4e-14 vs golden JS dan ≤ 3,6e-15 vs `irls::fit` |
| Biner wasm | Golden values via Node (`initSync`) | identik bit-per-bit (Δ = 0) |
| Antar mode (UI) | Per N: max \|Δβ\| dan max \|ΔSE\| tiap mode terhadap run pertama mode D, atas semua ulangan | kriteria < 1e-8 |
| Terhadap produksi (UI) | Tombol *Compare with production*: `calculate_binary_logistic` (Enter, opsi default, kategorik Indicator/Last) lewat worker produksi pada data N asli; baris "Constant" ↔ kolom intercept, kovariat dan dummy (`nama(j)`) dicocokkan lewat nama, baris omnibus grup kategorik dilewati | kriteria < 1e-4 |
| Port JS analisis lengkap | `scripts/checkEnterParity.mjs` (juga dijalankan Jest lewat `logisticEnterParity.experiment.test.js`): seluruh objek hasil `logistic_enter.js` vs `calculate_binary_logistic` Rust (paket eksperimen via `initSync`) pada 7 dataset: numerik, kategorik, step-halving + separasi, hampir separasi, kolinear sempurna, kolom nol, kategorik kecil. Semua field dibandingkan, termasuk pesan peringatan. Skrip yang sama memastikan string JSON `calculate_binary_logistic_timed` identik dengan `calculate_binary_logistic` | lulus; selisih berskala maks 7,3e-14 (kriteria \|Δ\| ≤ 1e-8 · max(1, \|a\|, \|b\|)); JSON ekspor ber-timer identik di 7 dataset |
| Ekspor ber-timer (Rust) | `cargo test`: `bench::enter_timed` (JSON lengkap, waktu dari jam palsu, determinisme, validasi dan pesan error sama dengan produksi) | lulus (38 test crate) |
| Batch analisis lengkap (UI) | Per N: hash tabel SPSS tiap run vs run pertama mode D, plus selisih berskala B/S.E. dari *Variables in the Equation* | kriteria: semua tabel identik dan selisih berskala < 1e-8 |
| Pipeline tabel SPSS (Jest) | `binaryLogisticExperiment.spssFormat.test.ts`: `logistic_enter.js` + formatter produksi pada data sintetis kategorik; ekstraksi B/S.E. vs `irlsCore` pada design matrix yang sama; hash deterministik; `toProductionPayload` | lulus; B/S.E. selisih < 1e-8 terhadap inti IRLS |
| Output viewer (E2E) | Tombol OK di keempat konfigurasi (D, A, B, C) pada dialog yang sama vs dialog Binary Logistic produksi untuk data dan variabel yang sama; batch *full* kecil; OK tanpa tabel SPSS; Close lalu buka lagi | header komponen, isi tabel, dan sintaks identik untuk keempat mode; tabel batch *full* identik di semua run; state dialog tetap ada |

Kasus step-halving di golden test dipilih dengan sengaja: semua perbandingan
log-likelihood pada kasus itu jauh di atas noise pembulatan (penurunan LL 0,55%
pada langkah penuh). Kasus ketika MLE ≈ 0 justru dihindari, karena di sana
`ll_new > ll_cur` hanya berbeda di tingkat noise (lihat §8).

## 8. Build wasm

Toolchain dan dependensi dikunci di crate `BinaryLogistic/rust`:

- `rust-toolchain.toml`: rustc 1.91.1 dengan target `wasm32-unknown-unknown`;
  rustup memasangnya otomatis saat cargo/wasm-pack dijalankan di folder crate.
  Bagian *producers* di `statify_logistic_bg.wasm` yang diukur mencatat rustc
  1.91.1 dan wasm-bindgen 0.2.129, tanpa fitur `simd128`.
- `Cargo.lock` (di-commit dengan `git add -f` karena `.gitignore` repo berisi
  `**/Cargo.lock`): nalgebra 0.32.6, statrs 0.16.1, serde_json 1.0.154,
  wasm-bindgen 0.2.129, serde-wasm-bindgen 0.4.5.
- wasm-pack 0.13.1 (`cargo install wasm-pack --version 0.13.1 --locked`); CLI
  wasm-bindgen yang sesuai lock dan wasm-opt (binaryen 117) diunduh otomatis.

Script build berupa script Node, jadi berjalan di Windows, Linux, dan macOS:

```bash
cd frontend
npm run build:wasm:experiment             # build lalu salin ke public/.../BinaryExperiment/pkg
npm run build:wasm:experiment -- --check  # build lalu bandingkan SHA-256 dengan pkg yang ter-commit
```

Script (`scripts/build-wasm-experiment.mjs`) menjalankan
`wasm-pack build --target web --release --out-dir target/experiment-pkg`
di crate `BinaryLogistic/rust` (profil release default: `opt-level = 3`, tanpa
LTO, lalu `wasm-opt -O`), kemudian menyalin `statify_logistic*` ke
`public/workers/Regression/BinaryExperiment/pkg/`. Dengan `--check` tidak ada
yang disalin; pada mesin build asli hasilnya byte-identik dengan paket yang
diukur. Di mesin lain hash-nya berbeda walau kodenya sama, karena rustc menanam
path absolut sumber dependensi (`~/.cargo/registry/...`) di pesan panic; kesamaan
perilaku dicek dengan `checkEnterParity.mjs` dan golden test di bawah. `rust/pkg` dan
`public/workers/Regression/Binary/pkg` produksi tidak disentuh. Paket
eksperimen memuat seluruh crate (termasuk fungsi produksi) plus modul `bench`
(`irls_core_bench`, `calculate_binary_logistic_timed`, `last_full_timings`),
sehingga ukuran `.wasm` (~763 KB) dan biaya `init()` sebanding dengan paket
produksi.

Unit test:

```bash
cd frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust
cargo test --locked
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

   ```bash
   cd frontend
   npm run build:experiment   # next build dengan NEXT_PUBLIC_GIT_COMMIT = HEAD
   npm run start              # next start -p 3001 → http://localhost:3001
   ```

   `build:experiment` (`scripts/build-experiment.mjs`) selalu mengisi
   `NEXT_PUBLIC_GIT_COMMIT` dari `git rev-parse --short HEAD`, mengabaikan nilai
   yang sudah ada di environment, dan menambahkan akhiran `-dirty` bila file yang
   dilacak git berubah (`-- --dry-run` hanya menampilkan nilainya). Jangan mengisi
   variabel itu manual lalu menjalankan `npm run build`: nilai yang tertinggal di
   terminal ikut ke build berikutnya. Itu yang terjadi pada keempat batch artikel,
   yang mencatat `gitCommit = 2c8bb04a` padahal build berasal dari `b6747315`
   (bukti di `reproducibility/REPRODUCE.md` §3).
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
   10.000 + 50.000 + 100.000. Jalankan **empat batch** dengan pengaturan dan
   dataset yang sama, berurutan dalam satu sesi; pengaturan batch di dialog
   dipakai bersama, jadi cukup ganti *Workload* dan centang lalu *Run batch* lagi:

   | Batch | Workload | *Fresh worker per run (cold)* | Siklus hidup B/D |
   |---|---|---|---|
   | 1 | IRLS core | tidak dicentang | persistent |
   | 2 | IRLS core | dicentang | per-run |
   | 3 | Full analysis + SPSS tables | tidak dicentang | persistent |
   | 4 | Full analysis + SPSS tables | dicentang | per-run |

   Runner otomatis menjalankan keempat batch yang sama di satu sesi browser dan
   menyimpan CSV + meta.json tiap batch ke `benchmark-results/` (batch per-run
   dengan akhiran `-per-run`, plus `browser.txt` berisi versi browser). Dari root
   repo setelah production build; runner menyalakan server sendiri di port yang
   diberikan:

   ```bash
   EXPERIMENT_BENCH_DATA=/path/to/dataset.csv \
   EXPERIMENT_BENCH_CHANNEL=chrome \
   EXPERIMENT_PORT=3002 \
   npx playwright test -c tests/experiment/playwright.experiment.config.ts benchmark-workloads
   ```

   Di PowerShell isi variabel yang sama dengan `$env:NAMA = "nilai"` lebih dulu.
   `EXPERIMENT_BENCH_CHANNEL=chrome` memakai Chrome terpasang, bukan Chromium
   bawaan Playwright. Default `EXPERIMENT_BENCH_WORKLOADS` adalah
   `core,core:per-run,full,full:per-run`; entri tanpa `:per-run` memakai worker
   persistent. Variabel lain (`EXPERIMENT_BENCH_DEPENDENT`,
   `EXPERIMENT_BENCH_COVARIATES`, `..._WARMUP`, `..._REPETITIONS`, `..._SEED`)
   dijelaskan di kepala file runner. Ringkasan cepat core vs full:
   `node frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/scripts/compareWorkloads.mjs benchmark-results/batch-*.csv`;
   tabel dan gambar artikel: `reproducibility/REPRODUCE.md`.

   Runner berjalan headless. Data artikel dikumpulkan manual di jendela Chrome
   biasa; bila memakai runner, catat versi browser dan bandingkan dengan batch
   dari jendela biasa.
8. Unduh **CSV** (satu baris per run) dan **meta.json** setelah setiap batch.
   Pastikan tabel akurasi lulus (< 1e-8; workload *full*: semua tabel SPSS
   identik) dan *Compare with production* lulus (< 1e-4).
   Pilih konfigurasi lalu klik **OK** untuk menjalankan analisis lengkap pada
   konfigurasi itu dan menyimpan laporan SPSS + kartu performa (dan ringkasan
   kedua batch) ke output viewer (lihat §6, *Tombol OK*). Dialog tetap
   terbuka; matikan *Include the SPSS tables* bila hanya perlu laporan performa.
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
  `droppedFrames` memakai interval refresh terukur T (`frameIntervalMs`), jadi
  layar 90/120 Hz menghasilkan lebih banyak frame terlewat untuk freeze yang
  sama; bandingkan antar mode pada mesin dan layar yang sama. Untuk mode main,
  `maxFrameGapMs` ≳ `computeMs` karena callback berikutnya baru bisa berjalan
  setelah inti selesai.
- **`performance.memory`** non-standar, terkuantisasi, dan hanya ada di main
  thread (tidak tersedia di worker; `measureUserAgentSpecificMemory` juga tidak
  ada di worker). `mainHeapUsedMB` mode B/D tidak memuat memori worker, jadi
  metrik memori **tidak bisa dibandingkan antarlokasi**; perbandingan memori
  yang sah hanya antarteknologi pada lokasi yang sama (A vs C), ditambah
  `wasmMemoryMB` untuk C/D.
- **Non-determinisme runtime.** GC, tier-up JIT, throttling thermal, dan
  penjadwalan OS menambah varians. Pengacakan urutan per ulangan mengurangi
  bias sistematis antar mode, tetapi ukuran N dijalankan berurutan (naik), jadi
  drift jangka panjang dapat bercampur dengan efek N.
- **Resampling dengan pengembalian** mempertahankan distribusi data asli tetapi
  menghasilkan baris duplikat; jumlah iterasi IRLS bisa berbeda antar N
  (tercatat di kolom `iterations`).
- **Workload *full* dan tombol OK bukan kontras runtime bersih.** A/B
  menjalankan port JS dan C/D kode Rust produksi. Algoritma dan urutan
  langkahnya sama dan hasilnya identik hingga pembulatan, tetapi
  implementasinya tidak: jalur produksi menyalin `x.transpose()` dua kali per
  iterasi IRLS, memakai perkalian matriks generik nalgebra dan SVD untuk
  condition number, lalu menserialisasi hasil ke JSON (dan JS memanggil
  `JSON.parse`), sedangkan port JS memakai loop terfusi tanpa salinan dan
  mengembalikan objek langsung. Selisih waktu *full* mencampur efek runtime
  dengan efek implementasi; kontras teknologi × lokasi yang bersih berasal dari
  workload *core*, dan `wasmCoreMs`/`wasmSerializeMs` membantu memilah biaya
  di dalam Wasm.
- **Per-run bukan first load.** Worker per-run adalah worker baru di halaman
  yang modul dan paket wasm-nya sudah pernah dimuat: cache HTTP browser dan
  cache kode V8 sudah panas. Yang diukur adalah biaya membuat dan menyiapkan
  worker baru, bukan analisis pertama setelah halaman dibuka.
- **Validitas eksternal.** Hasil berlaku untuk satu browser/mesin per batch;
  mesin JS dan Wasm lain (SpiderMonkey, JavaScriptCore) dapat berperilaku
  berbeda. Inti eksperimen sengaja lebih sederhana dari `irls::fit` produksi
  (§3), dan Wasm dijalankan single-thread tanpa SIMD.
