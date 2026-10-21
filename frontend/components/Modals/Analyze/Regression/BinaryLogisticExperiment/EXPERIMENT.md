# Strategi eksekusi untuk komputasi statistik di browser: WebAssembly, Web Worker, dan siklus hidup worker pada regresi logistik biner

Dokumen ini menjelaskan desain, implementasi, metrik, prosedur, dan keterbatasan
menu **Analyze → Regression → Binary Logistic (Experiment)**. Isinya disusun
sebagai bahan bagian *Method* artikel *Execution Strategies for Client-Side
Statistical Computing: A Factorial Case Study of WebAssembly, Web Workers, and
Worker Lifecycle in Logistic Regression*. Data, skrip analisis, dan langkah
reproduksi tabel dan gambar artikel ada di `reproducibility/REPRODUCE.md` (root repo).

**Versi.**

- **v1** (data artikel SAUCIS; tag `experiment-v1.0.0`, kode build yang diukur di tag
  `saucis-v1-data` = `b6747315`): satu browser (Chrome), dataset IBM HR Attrition dengan
  resampling, satu batch per siklus hidup worker (persistent dan per-run terpisah).
- **v2** (branch `experiment-v2`): keenam sel (A, B-warm, B-cold, C, D-warm, D-cold) diacak
  bersama di setiap repetisi (*interleaved*), dataset CDC BRFSS 100.000 baris dengan sampling
  *prefix*, sesi berulang di Chrome dan Firefox rilis resmi lewat orkestrator, dan pembanding
  native. Langkah dari clone sampai data mentah v2 ada di `REPRODUCE.md` (root repo).

Bagian yang hanya berlaku untuk v1 atau v2 ditandai; selebihnya berlaku untuk keduanya.

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

v2 mengulang desain yang sama di dua mesin browser, Chrome (V8) dan Firefox
(SpiderMonkey). Browser adalah lingkungan atau blok, bukan faktor strategi
eksekusi: sesi selang-seling Chrome/Firefox dengan seed urutan berbeda per sesi
(§9a). Kode mesin native dari `irls_core.rs` yang sama dipakai sebagai titik
pembanding untuk workload core (§8, *Pembanding native*).

## 2. Desain faktorial

| Kode | Teknologi | Lokasi | Kode yang dijalankan |
|---|---|---|---|
| A | JavaScript | Main thread | `irls_core.js` via `import()` di main thread |
| B | JavaScript | Web Worker | `irls_core.js` via `jsCore.worker.js` |
| C | Rust-WebAssembly | Main thread | `pkg/statify_logistic.js` → `irls_core_bench` di main thread |
| D | Rust-WebAssembly | Web Worker | `pkg/statify_logistic.js` → `irls_core_bench` via `wasmCore.worker.js` |

Siklus hidup worker adalah faktor **bersarang** di dalam lokasi worker: hanya
berlaku untuk B dan D, jadi desainnya bukan 2×2×2. Desainnya adalah faktorial
teknologi × lokasi (konfigurasi A–D), dengan dua tingkat siklus hidup untuk B dan D.
Kombinasi mode × siklus hidup disebut **sel**: A, B-warm, B-cold, C, D-warm, D-cold
(warm = persistent, cold = per-run).

| Worker lifecycle batch (dialog) | Sel per repetisi | Di data (CSV, meta.json) | Biaya pembuatan worker |
|---|---|---|---|
| Persistent | A, B-warm, C, D-warm | `lifecycle = persistent`, `workerStart = warm`, `coldWorkers = false` | sekali sebelum batch, di luar run (`warmSpawnMs*`, `warmInitMs*`, `warmEngineInitMs*` di meta) |
| Per-run | A, B-cold, C, D-cold | `lifecycle = per-run`, `workerStart = cold`, `coldWorkers = true` | setiap run, sebelum timer (`spawnMs`, `initMs`, `engineInitMs` per baris) |
| Interleaved (v2) | keenam sel | `lifecycle = interleaved`, `workerStart` per baris, `coldWorkers` kosong | worker persistent dibuat sebelum batch dan tetap hidup selama batch; sel cold membuat worker baru per run seperti per-run |

Untuk A dan C siklus hidup tidak berpengaruh karena tidak ada worker. Artikel v1
memakai empat batch: IRLS core dan full analysis, masing-masing dengan worker
persistent dan per-run. v2 memakai *Interleaved*, sehingga warm dan cold diukur
berselang-seling dalam repetisi yang sama dan berbagi kondisi drift atau thermal
yang sama. Run once dan OK memilih worker persistent atau per-run lewat radio
*Worker for Run once and OK*.

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
| `frontend/public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json` | SHA-256 keenam artefak yang diukur (§8) |
| `frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bench/` | Inti IRLS Rust (`irls_core.rs`) + golden test data |
| `frontend/components/Modals/Analyze/Regression/BinaryLogisticExperiment/` | Dialog, services, tipe, skrip (`scripts/`), dokumen ini |
| `frontend/scripts/` | Build lintas-OS: `build-experiment.mjs`, `build-wasm-experiment.mjs`, `hashArtifacts.mjs` (§8–9); v2: `runNative.mjs`, `validateRun.mjs` (§8, §9a) |
| `frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust/src/bin/irls_native_bench.rs` | v2: pembanding native `irls_core` (§8) |
| `experiment-data/` | v2: dataset BRFSS 100k + manifest (`raw/` tidak di-commit), dibuat `scripts/prepareBrfss.mjs` (§4) |
| `tests/experiment/orchestrate.mjs`, `bench.v2.json`, `bench.v2.mini.json` | v2: orkestrator sesi Chrome/Firefox (§9a); `bench.v1-hr.json` = default runner legacy |
| `frontend/__tests__/irlsCore.experiment.test.js`, `binaryLogisticExperiment.*.test.{ts,js}`, `logisticEnterParity.experiment.test.js` | Unit test Jest |
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

**Ukuran N: sampling** (pengaturan batch *Sampling*, kolom `sampling`):

- **Resample** (v1, `resample(X, y, n, p, targetN, dataSeed)`): baris diambil seragam
  **dengan pengembalian** memakai PRNG mulberry32 ber-seed (`idx = floor(u · n)`). Bila
  `targetN = n`, data asli dipakai tanpa resampling. Seed yang sama memberi dataset yang
  sama, sehingga semua sel pada ukuran N yang sama memproses data identik. Seed dipakai
  langsung untuk setiap N, sehingga dataset N kecil adalah awalan dari aliran indeks N besar.
- **First N rows / prefix** (v2, default dialog; `takePrefix`, `prefixFull`): N baris
  pertama data yang sudah dipersiapkan, **tanpa pengembalian**. N > n ditolak dengan pesan
  jelas sebelum batch dimulai. Workload core (design matrix) dan full (kovariat mentah) memakai
  baris yang sama persis. Prefix adalah sampel acak sederhana karena dataset v2 sudah diacak
  oleh skrip persiapan (di bawah), dan dataset N kecil adalah awalan dataset N besar.

**Seed** (v2 memisahkan `seed` v1 menjadi dua; keduanya dicatat di `meta.settings` dan CSV):

- `dataSeed`: hanya untuk *Resample* (kolom CSV lama `seed` berisi nilai ini).
- `orderSeed`: urutan sel per repetisi (`mulberry32(deriveSeed(orderSeed, N))`, sama dengan
  v1 bila `orderSeed` = seed v1, sehingga urutan batch v1 terulang persis), urutan N bila
  *Size order* = *Shuffled* (`deriveSeed(orderSeed, −1)`), dan urutan workload per sesi di
  orkestrator (`deriveSeed(orderSeed, −2)`). Salt negatif tidak pernah bertabrakan dengan
  stream per-N karena N selalu positif.
- meta.json v1 (`seed`, `coldWorkers`) tetap terbaca lewat `services/settings.ts`
  (`normalizeBatchSettings`): `seed` → `dataSeed` = `orderSeed`, `coldWorkers` → `lifecycle`.

**Dataset v2: CDC Diabetes Health Indicators (BRFSS 2015)**
(`scripts/prepareBrfss.mjs`, Node ≥ 18, tanpa dependency):

1. Input: CSV Kaggle `diabetes_binary_health_indicators_BRFSS2015.csv` (UCI
   doi:10.24432/C53919), disimpan di `experiment-data/raw/` (tidak di-commit). Divalidasi:
   header persis 22 kolom, tepat 253.680 baris data, nilai kolom terpilih sesuai codebook.
2. Kolom: `Diabetes_binary` (dependen); `HighBP`, `HighChol`, `BMI`, `PhysActivity`, `Sex`,
   `Age`, `Income` (numerik); `GenHlth` (kategorik). Angka ditulis dalam bentuk desimal
   terpendek (`40.0` → `40`). GenHlth 1–5 menjadi label `1_excellent` … `5_poor`, karena
   import CSV Statify menandai kolom yang semuanya angka sebagai *scale*. Urutan
   `localeCompare` label sama dengan urutan kode, jadi Indicator/Last memakai `5_poor` sebagai
   referensi: p = 1 + 7 + 4 = 12.
3. Semua baris diacak dengan Fisher–Yates mulberry32 seed 42 (salinan `services/prng.ts`,
   kesamaannya dicek Jest), lalu 100.000 baris pertama ditulis ke
   `experiment-data/brfss_bench_100k.csv` (SHA-256 `95db7a46…a3fa`, disimpan byte demi byte
   lewat `.gitattributes`).
4. `brfss_bench_100k.manifest.json`: SHA-256 input dan output, seed, kolom, jumlah baris,
   prevalensi `Diabetes_binary` (input 13,93%, output 13,88%), dan frekuensi GenHlth untuk
   input, output, serta prefix 1.000/10.000/50.000/100.000. Skrip gagal bila suatu prefix
   kehilangan kategori GenHlth atau salah satu kelas Y (p akan berubah).

Pada N = 100.000, keempat mode konvergen dalam 7 iterasi (1 step-halving), −2LL = 64137,6496,
dan *Compare with production* lulus (max |Δ| 1,87e-14).

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

**Kolom v2.** Kolom v1 tetap di tempatnya; header CSV v2 diawali persis oleh header CSV v1
(diuji terhadap `reproducibility/data/core_warm.csv`), dan kolom berikut ditambahkan di
belakang `batchStartedAt`:

| Kolom | Definisi |
|---|---|
| `sampling`, `dataSeed`, `orderSeed`, `sizeOrder` | Pengaturan batch (§4). Kolom lama `seed` = `dataSeed`. |
| `sizeOrderIndex` | Posisi N ini (1-based) dalam urutan N yang dipakai batch (`meta.sizeOrderUsed`). |
| `cell` | Sel desain: `A`, `B-warm`, `B-cold`, `C`, `D-warm`, `D-cold`. `orderInRep` bernilai 1..4 (persistent/per-run) atau 1..6 (interleaved). |
| `lifecycle` | Pengaturan batch: `persistent`, `per-run`, atau `interleaved`. Kolom lama `coldWorkers` = `false`/`true` untuk dua yang pertama dan kosong untuk interleaved. |
| `spawnMaxFrameGapMs`, `spawnDroppedFrames`, `spawnLongTaskCount` | Sel cold saja: responsivitas main thread selama start-up worker per-run. FrameMonitor kedua berjalan dari tepat sebelum `new Worker` sampai worker siap, termasuk `init_full` untuk workload full. Definisinya sama dengan `maxFrameGapMs`, `droppedFrames`, dan `longTaskCount`, tetapi untuk jendela start-up, yang berada di luar jendela ukur. `spawnLongTaskCount` null tanpa dukungan longtask (Firefox). |
| `dispatchLatencyMs`, `returnLatencyMs`, `workerHandlerMs` | Sel worker saja: rincian `overheadMs` dari stempel epoch `performance.timeOrigin + performance.now()`. Worker mencatat `tRecvEpochMs` di baris pertama handler pesan `run`/`run_full` dan `tPostEpochMs` tepat sebelum `postMessage` hasil; main thread mengubah t0/t1 ke epoch dengan cara yang sama. dispatch = tRecv − t0, return = t1 − tPost, handler = tPost − tRecv (handler memuat `computeMs`). Null untuk mode main. |
| `clockCheckFailed` | `true` bila salah satu dari tiga nilai di atas < −0,05 ms (jam epoch main thread dan worker tidak konsisten). Null untuk mode main. |
| `t0PhaseMs`, `t1PhaseMs`, `nextFrameAfterT1Ms` | Fase terhadap frame, dihitung dari stempel rAF yang sudah dicatat FrameMonitor (jam yang sama dengan t0/t1): t0 − callback rAF terakhir ≤ t0; t1 − callback rAF terakhir ≤ t1; callback rAF pertama > t1 dikurangi t1. Definisi metrik frame lama tidak berubah. |
| `sessionId`, `sessionIndex`, `sessionRole` | Dari query URL orkestrator (`expSession`, `expSessionIndex`, `expRole` = `pilot`/`measure`); kosong untuk batch manual. |
| `browserName`, `browserVersion` | Hasil deteksi di halaman (`environment.browserName/Version`, di bawah). |

Tambahan `meta.json` v2: `settings` (bentuk baru; meta v1 dibaca lewat
`normalizeBatchSettings`), `sizeOrderUsed`, `orders` (urutan **sel** tiap N dan repetisi),
`session` (`{ id, index, role, browser }` dari query URL, atau null), dan di `environment`:

- `browserName`, `browserVersion`: Chromium dari `navigator.userAgentData.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness"])` (`uaHighEntropy`; UA Chrome direduksi menjadi `Chrome/155.0.0.0`), Firefox dari UA `Firefox/x.y`.
- `webdriver` (`navigator.webdriver`), `devicePixelRatio`, `innerWidth`, `innerHeight`.
- `hasFocusStart`/`hasFocusEnd` dan `visibilityStart`/`visibilityEnd`: `document.hasFocus()` dan `visibilityState` di awal dan akhir batch.
- `battery` (`navigator.getBattery()`: `charging`, `level`; null di Firefox).
- `artifactHashes`: isi `files` dari `ARTIFACT_HASHES.json` build ini.
- `wasmSha256Runtime`, `wasmHashVerified`: SHA-256 `.wasm` yang disajikan, dihitung dengan `crypto.subtle` **setelah** semua run batch. Fetch sebelum preload akan membuat `init()` hanya merevalidasi cache HTTP, sehingga `mainWasmInitMs` tidak lagi sama definisinya dengan v1.
- `gitCommit`: `git describe --always --dirty --abbrev=8` saat build, termasuk penanda `-dirty`.

API khusus Chromium (`longtask`, `performance.memory`, `userAgentData`, `getBattery`) menghasilkan null di Firefox, bukan error.

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
ukuran N, dalam urutan naik (*Size order* = *Ascending*, v1) atau diacak dengan
`orderSeed` (*Shuffled*, v2; urutan yang dipakai di `meta.sizeOrderUsed` dan kolom
`sizeOrderIndex`):

1. Dataset N dibentuk sekali, dengan *Resample* (`resample`, `dataSeed`) atau *First N rows*
   (`takePrefix`) (§4). Workload *full* memakai `resampleFull`/`prefixFull` pada kovariat
   mentah, sehingga barisnya identik dengan dataset workload *core*.
2. **Warm-up**: `W` ronde (default 5), tidak dicatat. Setiap ronde menjalankan
   setiap sel sekali. Warm-up diulang per N agar JIT/tier-up (V8 TurboFan atau
   SpiderMonkey Warp untuk JS, Liftoff → TurboFan atau baseline → Ion untuk Wasm) dan
   alokator memori berada pada kondisi tunak untuk ukuran tersebut.
3. **Ulangan**: `R` ronde (default 30). Pada setiap ronde, **urutan sel diacak**
   (4 sel, atau 6 untuk *Interleaved*) dengan Fisher–Yates ber-seed (stream terpisah:
   `mulberry32(deriveSeed(orderSeed, N))`) untuk mengurangi bias drift/thermal. Urutan
   tercatat di `meta.json` (`orders`, berisi id sel) dan kolom `orderInRep`.
4. Setiap run:
   1. Modul/worker disiapkan (di luar timer). Worker persistent dibuat dan di-init
      (termasuk `init_full` untuk workload full) sekali sebelum batch. Untuk sel cold
      (siklus hidup per-run, atau sel B-cold/D-cold pada *Interleaved*), worker baru dibuat
      dan di-init untuk setiap run sebelum timer, lalu diakhiri setelah run. Selama start-up
      itu FrameMonitor kedua mengukur responsivitas (`spawn*`, §5). Prosesnya: menunggu satu
      frame baseline, task baru, `new Worker` sampai siap, lalu satu frame lagi, sehingga sel
      cold punya jeda ±1–2 frame lebih banyak sebelum jendela ukurnya dimulai. Pada
      *Interleaved*, worker persistent B dan D tetap hidup (idle) saat sel cold berjalan.
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

Total run = |N| × (W + R) × jumlah sel (4, atau 6 untuk *Interleaved*). Ringkasan per
(N, sel): median, IQR (Q1–Q3, kuantil tipe 7 seperti default R/NumPy), min, dan max untuk
`computeMs`, `e2eMs`, dan `maxFrameGapMs` (workload *full*: juga `formatMs` dan `totalMs`),
plus chart median dengan whisker IQR (sumbu x: main thread, worker persistent, worker per-run).
Acuan validasi akurasi: run sukses pertama sel D-warm pada N yang sama (D-cold untuk batch
per-run), juga untuk kolom `tablesIdenticalToD`.

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
| Antar sel (UI) | Per N: max \|Δβ\| dan max \|ΔSE\| tiap sel terhadap run sukses pertama D-warm (D-cold untuk batch per-run), atas semua ulangan | kriteria < 1e-8 |
| Lintas sel, sesi, dan browser (v2) | `scripts/validateRun.mjs`: \|ΔB\| dan \|ΔS.E.\| semua run setiap sesi terhadap run D-warm pertama sesi pertama, per workload dan N | kriteria < 1e-8; uji coba Chrome 155 + Firefox 158: ≤ 7e-15 |
| Native (v2) | `scripts/runNative.mjs`: β dan SE `irls_core` native vs D-warm sesi pilot | kriteria \|Δ\| ≤ 1e-12 · max(1, \|nilai\|); uji coba: ≤ 2,6e-15 |
| Terhadap produksi (UI) | Tombol *Compare with production*: `calculate_binary_logistic` (Enter, opsi default, kategorik Indicator/Last) lewat worker produksi pada data N asli; baris "Constant" ↔ kolom intercept, kovariat dan dummy (`nama(j)`) dicocokkan lewat nama, baris omnibus grup kategorik dilewati | kriteria < 1e-4 |
| Port JS analisis lengkap | `scripts/checkEnterParity.mjs` (juga dijalankan Jest lewat `logisticEnterParity.experiment.test.js`): seluruh objek hasil `logistic_enter.js` vs `calculate_binary_logistic` Rust (paket eksperimen via `initSync`) pada 7 dataset: numerik, kategorik, step-halving + separasi, hampir separasi, kolinear sempurna, kolom nol, kategorik kecil. Semua field dibandingkan, termasuk pesan peringatan. Skrip yang sama memastikan string JSON `calculate_binary_logistic_timed` identik dengan `calculate_binary_logistic` | lulus; selisih berskala maks 7,3e-14 (kriteria \|Δ\| ≤ 1e-8 · max(1, \|a\|, \|b\|)); JSON ekspor ber-timer identik di 7 dataset |
| Ekspor ber-timer (Rust) | `cargo test`: `bench::enter_timed` (JSON lengkap, waktu dari jam palsu, determinisme, validasi dan pesan error sama dengan produksi) | lulus (38 test crate) |
| Batch analisis lengkap (UI) | Per N: hash tabel SPSS tiap run vs run sukses pertama D-warm, plus selisih berskala B/S.E. dari *Variables in the Equation* | kriteria: semua tabel identik dan selisih berskala < 1e-8 |
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
- `Cargo.lock` (di-commit; `.gitignore` repo berisi `**/Cargo.lock` dan hanya
  path crate ini yang dikecualikan): nalgebra 0.32.6, statrs 0.16.1, serde_json 1.0.154,
  wasm-bindgen 0.2.129, serde-wasm-bindgen 0.4.5.
- wasm-pack 0.13.1 (`cargo install wasm-pack --version 0.13.1 --locked`); CLI
  wasm-bindgen yang sesuai lock dan wasm-opt (binaryen 117) diunduh otomatis.

Script build berupa script Node, jadi berjalan di Windows, Linux, dan macOS:

```bash
cd frontend
npm run build:wasm:experiment             # build lalu salin ke public/.../BinaryExperiment/pkg
npm run build:wasm:experiment -- --check  # build lalu bandingkan SHA-256 dengan pkg yang ter-commit
```

Script (`frontend/scripts/build-wasm-experiment.mjs`) menjalankan
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

**Hash artefak.** `frontend/scripts/hashArtifacts.mjs` menulis SHA-256 keenam artefak
yang diukur (`pkg/statify_logistic_bg.wasm`, `pkg/statify_logistic.js`, `irls_core.js`,
`logistic_enter.js`, `jsCore.worker.js`, `wasmCore.worker.js`) ke
`public/workers/Regression/BinaryExperiment/ARTIFACT_HASHES.json` dan dijalankan
otomatis oleh `npm run build:experiment` (§9). File `.wasm` di-hash byte demi byte;
file teks di-hash setelah CRLF → LF, karena dengan `core.autocrlf=true` byte di disk
bergantung pada OS dan waktu checkout. Hasilnya sama dengan isi blob git di semua OS
(`git show HEAD:<path> | sha256sum`). `--check` membandingkan tanpa menulis. Paket wasm
yang diukur: SHA-256 `3a1104c816ae140620a7d1cb2f13060a6072cfbe71de4d4026d29dcf8e61505d`,
dipatok juga oleh test Jest `binaryLogisticExperiment.artifacts.test.js`.

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

### Pembanding native (v2)

`irls_core` yang sama dengan paket wasm juga dikompilasi native sebagai **titik pembanding**
untuk workload *core* dalam kondisi warm. Native **bukan faktor eksperimen**: tidak ada di
desain teknologi × lokasi × siklus hidup, tidak diacak bersama sel browser, dan tidak masuk
analisis faktorial. Gunanya menunjukkan berapa jauh JS/Wasm di browser dari kode mesin untuk
algoritma yang identik.

- Biner `src/bin/irls_native_bench.rs` di crate `BinaryLogistic/rust` memanggil
  `bench::irls_core::irls_core` lewat library crate (tidak disalin). Tanpa dependensi baru,
  jadi `Cargo.lock` (dan paket wasm yang diukur) tidak berubah; SHA-256 ditulis di biner itu.
- Input: design matrix workload core per N yang diekspor orkestrator
  (`benchmark-results/<runId>/design/N<N>.X.f64`, `.y.f64`, `.json`; Float64 little-endian,
  baris prefix yang sama dengan batch), diverifikasi SHA-256-nya sebelum dipakai.
- Setiap N (urutan diacak per proses): warm-up 5 lalu 30 repetisi; waktu diukur
  `std::time::Instant` **hanya** di sekitar pemanggilan `irls_core` (setara `wasmCoreMs`).
  Keluaran CSV: `invocation, N, p, rep, computeMs, iterations, converged, neg2ll, beta_*, se_*`.
- `frontend/scripts/runNative.mjs <runDir>` membangun
  `cargo build --release --locked --bin irls_native_bench` (toolchain terkunci, target host
  default x86-64 tanpa `-C target-cpu=native`; `RUSTFLAGS` dari environment dikosongkan),
  mencatat `rustc -Vv` dan model CPU, menjalankan 10 proses terpisah dengan jeda 10 detik, dan
  menulis `<runDir>/native/` (`invocation-NN.csv`, `native.json`).
- Cek otomatis: β dan SE native harus sama dengan sel D-warm (run sukses pertama tiap N) sesi
  pilot, |Δ| ≤ 1e-12 · max(1, |nilai|). Uji coba: selisih berskala maksimum ±1e-15.

## 9. Panduan menjalankan benchmark dengan benar

1. **Wajib production build.** `next dev` memakai React development mode,
   source map, dan HMR sehingga angka tidak representatif (dialog menampilkan
   peringatan bila bukan production build; kolom `buildMode` di CSV harus
   `production`).

   ```bash
   cd frontend
   npm run build:experiment   # hash artefak + next build dengan NEXT_PUBLIC_GIT_COMMIT dari git describe
   npm run start              # next start -p 3001 → http://localhost:3001
   ```

   `build:experiment` (`frontend/scripts/build-experiment.mjs`, lintas-OS) berjalan
   dalam empat langkah:
   1. `hashArtifacts.mjs` memperbarui `ARTIFACT_HASHES.json` (§8).
   2. `NEXT_PUBLIC_GIT_COMMIT` selalu diisi dengan
      `git describe --always --dirty --abbrev=8` (mis. `experiment-v1.0.0-3-g1a2b3c4d`,
      atau akhiran `-dirty`), dan nilai yang sudah ada di environment diabaikan.
   3. Build **ditolak** (exit 1) bila working tree dirty, yaitu ada file terlacak yang
      berubah, kecuali `EXPERIMENT_ALLOW_DIRTY=1`. File untracked tidak dihitung, sama
      dengan `git describe --dirty`. Karena hash dihitung lebih dulu, artefak yang
      berubah tanpa `ARTIFACT_HASHES.json` baru yang di-commit juga menggagalkan build.
   4. `frontend/next-env.d.ts` (dilacak git, tetapi ditulis ulang Next pada setiap
      build) dikembalikan ke versi HEAD sebelum cek dan sesudah `next build`.

   `-- --dry-run` hanya menampilkan nilai dan keputusan build tanpa menulis apa pun.
   Jangan mengisi variabel itu manual lalu menjalankan `npm run build`: nilai yang
   tertinggal di terminal ikut ke build berikutnya. Itu yang terjadi pada keempat batch
   artikel v1, yang mencatat `gitCommit = 2c8bb04a` padahal build berasal dari `b6747315`
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
7. Pengaturan baku v1: warm-up 5, ulangan 30, seed dicatat, ukuran N asli +
   10.000 + 50.000 + 100.000, *Sampling* = *Resample*, *Size order* = *Ascending*,
   *Data seed* = *Order seed*. Jalankan **empat batch** dengan pengaturan dan dataset
   yang sama, berurutan dalam satu sesi; pengaturan batch di dialog dipakai bersama,
   jadi cukup ganti *Workload* dan *Worker lifecycle* lalu *Run batch* lagi:

   | Batch | Workload | *Worker lifecycle* |
   |---|---|---|
   | 1 | IRLS core | Persistent |
   | 2 | IRLS core | Per-run |
   | 3 | Full analysis + SPSS tables | Persistent |
   | 4 | Full analysis + SPSS tables | Per-run |

   Untuk v2 pakai orkestrator (§9a), bukan langkah manual ini.

   Runner legacy menjalankan keempat batch yang sama di satu sesi browser dan
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
   persistent. Default dataset HR Attrition ada di `tests/experiment/bench.v1-hr.json`;
   variabel lain (`EXPERIMENT_BENCH_DEPENDENT`, `EXPERIMENT_BENCH_COVARIATES`, `..._WARMUP`,
   `..._REPETITIONS`, `..._SEED`, `EXPERIMENT_BENCH_CONFIG`) dijelaskan di kepala file
   runner. Ringkasan cepat core vs full, per sel:
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

## 9a. Protokol sesi v2: orkestrator, pembanding native, validasi

Perintah lengkap dari clone sampai data mentah (Windows dan Linux): `REPRODUCE.md` di root
repo. Ringkasnya:

1. **Build bersih**: `npm run build:experiment` dari working tree yang sudah di-commit (§9.1);
   `gitCommit` di setiap meta.json harus tanpa `-dirty`.
2. **Mesin**: dicolok charger, mode daya *Best performance*, jangan dipakai selama run
   (orkestrator membawa jendela browser ke foreground sebelum tiap batch), notifikasi dan
   pembaruan otomatis dimatikan, layar tidak mati atau terkunci.
3. **Sesi**: `node tests/experiment/orchestrate.mjs` (konfigurasi
   `tests/experiment/bench.v2.json`):
   - Jadwal selang-seling: `pilot-chrome`, `pilot-firefox`, `chrome-01`, `firefox-01`, …,
     `firefox-10` (22 sesi). `orderSeed` = 1000 + indeks global sesi; `--plan` menampilkan
     jadwal, urutan workload, dan seed.
   - Setiap sesi memakai browser **rilis resmi yang terpasang** (`executablePath`, bukan build
     Playwright), diluncurkan Puppeteer lewat WebDriver BiDi (Chrome dan Firefox, protokol
     yang sama), headed, dengan profil sementara baru yang dihapus saat browser ditutup.
   - Aplikasi dibuka dengan `?expAutomation=1&expSession=…&expSessionIndex=…&expRole=…&expBrowser=…`;
     dataset diimpor lewat input file, variabel dipilih, lalu pengaturan diisi:
     N {1.000; 10.000; 50.000; 100.000}, warm-up 5, ulangan 30, *First N rows*,
     *Shuffled*, *Interleaved*, `orderSeed` sesi.
   - Kedua workload dijalankan dalam urutan acak per sesi (840 run per batch).
   - Selama batch orkestrator **tidak berinteraksi dengan halaman**: ia menunggu satu evaluate
     `window.__blExp.waitForBatchOutputs(n)` yang selesai sendiri (tanpa polling
     rAF/MutationObserver).
   - Sebelum tiap batch, jendela dimaksimalkan dan dibawa ke foreground OS (user32
     `ShowWindow` + `SetForegroundWindow` dengan tombol F24 tanpa efek untuk membuka foreground
     lock; mekanisme sama untuk kedua browser), lalu `page.bringToFront()`. Status foreground
     OS di awal dan akhir batch dicatat di `session.json`.
   - Output: `benchmark-results/<runId>/<browser>/<role>-<NN>/` berisi CSV + meta.json tiap
     batch (isi sama dengan Download CSV) dan `session.json` (CPU, RAM, OS, versi Node dan
     Puppeteer, `browser.version()`, argumen peluncuran lengkap, `user.js` Firefox, waktu,
     status, error). Konfigurasi, jadwal, build, dan SHA-256 dataset ada di `run.json`.
   - Cooldown 120 detik antar sesi. Sesi yang sudah lengkap dilewati bila run dilanjutkan
     (`--run-id <id>`); `--only chrome-03` mengulang satu sesi (output lama diganti nama);
     `--role pilot|measure` membatasi ke sesi satu peran. Sesi gagal dicatat lalu sesi
     berikutnya tetap dijalankan. Timeout per batch 45 menit.
   - Run yang dilanjutkan harus memakai config yang sama dengan `run.json` (selain itu
     orkestrator berhenti). Cooldown juga berlaku antar-invocation: bila sesi terakhir run itu
     selesai kurang dari 120 detik lalu (mis. fase pilot langsung disusul fase measure), sesi
     pertama ditunda sampai 120 detik terpenuhi.
   - Info build `.next/EXPERIMENT_BUILD.json` (ditulis `npm run build:experiment`: gitCommit,
     commit HEAD, BUILD_ID) dicatat di `run.json` dan `session.json`.
   - Sebelum sesi pertama, design matrix workload core tiap N diekspor ke `design/` untuk
     pembanding native.
4. **Native**: `cd frontend && node scripts/runNative.mjs ../benchmark-results/<runId>`
   (§8, *Pembanding native*): 10 proses, cek β/SE terhadap D-warm sesi pilot.
5. **Validasi**: `node scripts/validateRun.mjs ../benchmark-results/<runId>`. Cek:
   - jumlah run per (workload, N, sel) = 30; tanpa error; `pageHidden` selalu false;
     `clockCheckFailed` tidak pernah true;
   - semua run konvergen dengan jumlah iterasi sama; tabel SPSS identik (full);
   - |ΔB|, |ΔS.E.| < 1e-8 antar sel, sesi, dan browser;
   - `gitCommit` sama dan tanpa `-dirty`; hash wasm sesuai dan `wasmHashVerified`;
   - versi browser, viewport, dan DPR sama per browser; `visibilityState` "visible" dan
     jendela foreground OS di awal dan akhir tiap batch.

   Ringkasan Markdown (`validation.md`) berisi durasi sesi, median `computeMs`/`e2eMs` per sel
   per sesi, dan sesi yang menyimpang > 25% dari median sesi lain browser yang sama. Exit
   code ≠ 0 bila ada pelanggaran. `document.hasFocus()` hanya dilaporkan (lihat §10).
6. Dry run sebelum run sungguhan: `--config tests/experiment/bench.v2.mini.json` (2 N, warm-up 1,
   ulangan 2, tanpa pilot, satu sesi per browser), lalu validator dan
   `runNative.mjs --invocations 1`. Hasil dry run bukan data artikel.
7. **Hari-H** (`frontend/scripts/preflight.mjs`, `frontend/scripts/benchDay.mjs`) menjalankan
   langkah 3–5 dalam dua perintah, dengan seluruh output konsol juga di
   `benchmark-results/<runId>/day.log`:
   - `npm run bench:preflight`: cek baca-saja (charger dan mode daya, versi browser, updater,
     git bersih, build = HEAD tanpa `-dirty`, ARTIFACT_HASHES.json dan biner .wasm, dataset,
     server dengan COOP/COEP, proses pengganggu, disk ≥ 5 GB), hijau/kuning/merah, exit 1 bila
     ada merah. Versi browser disimpan di `benchmark-results/preflight-<waktu>.json`.
   - `npm run bench:day -- --phase pilot`: preflight (merah = berhenti sebelum sesi pertama),
     orkestrator `--role pilot`, validator sesi pilot (`validation-pilot.md`), ringkasan,
     perkiraan durasi fase measure, dan perintah berikutnya.
   - `npm run bench:day -- --phase measure --run-id <runId>`: preflight, orkestrator
     `--role measure` (perintah yang sama melanjutkan run yang terputus), native 10 invocation,
     validator seluruh run, versi browser setiap sesi = versi di file preflight pilot dan measure,
     lalu `benchmark-results/<runId>.zip`. Fase ini menolak run yang validasi pilotnya gagal,
     kecuali dengan `--force`.
   - `--dry` menguji alur yang sama dengan config mini (ditambah 1 sesi pilot per browser,
     runId `dry-…`, native 2 invocation).

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
  (§3), dan Wasm dijalankan single-thread tanpa SIMD. v2 menambah Firefox
  (SpiderMonkey), tetapi tetap satu mesin, satu OS (Windows 11), dan satu layar.

Keterbatasan tambahan v2:

- **Otomasi browser.** Sesi berjalan di bawah WebDriver BiDi (Puppeteer), jadi
  `navigator.webdriver = true`. Chrome memakai argumen default Puppeteer, antara lain
  `--enable-automation`, `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
  `--disable-background-networking`, dan `--disable-features=Translate,…`. Firefox memakai pref
  profil otomasi, antara lain `focusmanager.testmode`, `dom.max_script_run_time = 0`,
  `hangmonitor.timeout = 0`, dan Normandy mati. Daftar lengkapnya dicatat per sesi di
  `session.json` (`spawnargs`, `firefoxUserJs`). Kedua browser tidak mengunduh eksperimen
  sisi server selama sesi.
- **Fokus.** Di bawah otomasi BiDi, Firefox selalu melaporkan `document.hasFocus() = false`,
  bahkan bila jendelanya foreground OS (sudah diuji dengan `SetForegroundWindow`, `window.focus()`,
  `bringToFront`, dan `focusmanager.testmode = false`). Chrome melaporkan true setelah
  `bringToFront`. Karena itu validator memakai `visibilityState` dan status foreground OS (sama
  untuk kedua browser); `hasFocus` hanya dicatat. Dengan jendela foreground di kedua browser,
  *foreground boost* penjadwal Windows berlaku setara.
- **Viewport dan DPR.** Viewport tidak diemulasi dan tidak disamakan antar browser. Di layar
  laptop 1920×1080 dengan skala Windows 165%, viewport 1600×1000 CSS px tidak muat, dan
  `browsingContext.setViewport` Firefox tidak pernah selesai di layar berskala. Jendela kedua
  browser dimaksimalkan lewat OS, sehingga viewport-nya 1164×511 CSS px @1,65 (Chrome, dengan
  infobar otomasi) dan 1152×575 @1,667 (Firefox). DPR memang tidak bisa disamakan: Firefox
  menyatakan DPR sebagai 60/n dengan n bulat (*app units*), jadi skala 1,65 menjadi
  60/36 = 1,667. Alasan viewport tidak disamakan:
  1. Ukuran viewport tidak masuk ke besaran yang diukur. Progres batch di-render di luar
     jendela ukur. Selama jendela ukur halaman tidak berubah, kecuali ekor transisi progress
     bar (poin berikut) dan ikon spinner (animasi `transform` yang dijalankan compositor).
     Keduanya elemen kecil yang sama di semua sel.
  2. Sel dibandingkan di dalam browser yang sama, dan viewport konstan per browser.
  3. Viewport CSS yang sama pun tidak menyamakan pekerjaan render antar engine, karena DPR,
     font, scrollbar, dan UI browser tetap berbeda. Perbedaan antar browser dibaca sebagai
     efek browser secara keseluruhan.

  Nilai aktual tercatat per batch (`devicePixelRatio`, `innerWidth`, `innerHeight`), dan
  validator mewajibkan nilainya sama di semua batch browser yang sama. Jendela yang gagal
  dimaksimalkan akan terdeteksi: di uji asap dengan `--window-position`, viewport Chrome
  menjadi 1037×486.
- **Transisi progress bar.** Lebar progress bar batch memakai transisi CSS 150 ms
  (`transition-[width]`), lebih lama dari jeda antar run (2 frame + 50 ms ≈ 83 ms pada 60 Hz).
  Akibatnya, ekor transisi (±4 frame pada 60 Hz) masuk ke awal jendela ukur run berikutnya:
  style, layout, dan paint satu elemen kecil per frame di main thread. Kondisi ini sama untuk
  semua sel dan sama dengan v1. Ia sengaja tidak diubah agar titik ukur tetap sama.
- **Resolusi timer.** Firefox (cross-origin isolated) memberi 20 µs, Chrome 5 µs
  (`timerResolutionMs`), sehingga `computeMs` N kecil dan rincian latensi worker lebih kasar
  di Firefox. `longTaskCount`, `mainHeapUsedMB`, `battery`, dan `uaHighEntropy` null di Firefox.
- **Sel cold.** Monitor start-up menambah jeda ±1–2 frame sebelum jendela ukur sel cold, dan
  stempel epoch worker menambah dua pembacaan jam (µs) di dalam rentang `e2eMs` mode worker.
  Keduanya di luar `computeMs`. Pada *Interleaved*, worker persistent B dan D tetap hidup
  (idle) saat sel cold berjalan, sedangkan di batch per-run v1 tidak ada.
- **Sampling prefix.** Semua sesi memakai baris yang sama untuk N yang sama (prefix dataset
  yang sudah diacak sekali dengan seed 42). Variasi antar sesi berasal dari urutan dan
  lingkungan, bukan dari data.
