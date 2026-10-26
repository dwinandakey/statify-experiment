# Statify: Pengembangan Angkatan 64

Dokumen ini merangkum kontributor dan modul yang dikembangkan oleh mahasiswa **Politeknik Statistika STIS angkatan 64**. Gambaran umum aplikasi, cara menjalankan, dan struktur repositori ada di [README.md](README.md).

## Pengantar

Pada siklus pengembangan tahun ini, Tim Statify mengembangkan sebelas modul secara paralel, yaitu modul uji statistik parametrik dan nonparametrik lanjutan, analisis faktor, GLM multivariate dan repeated measures, time series, regresi logistik biner, regresi ordinal, regresi logistik multinomial, analisis diskriminan, nearest neighbor, K-medoids, serta text analytics.

Seluruh modul dikembangkan di atas arsitektur yang sama: antarmuka React di browser, perhitungan statistik dengan **Rust yang dikompilasi ke WebAssembly** di dalam Web Worker, dan tampilan hasil bergaya SPSS. Modul-modul tersebut digabung ke satu aplikasi Statify yang dapat diakses di https://statify-dev.student.stis.ac.id/.

## Daftar Modul dan Kontributor

| No | Modul | Mahasiswa | Bagian |
|---|---|---|---|
| 1 | Uji statistik parametrik dan nonparametrik lanjutan | Daniel Dabra Pasongli (222212555) | [Uji Statistik Parametrik dan Nonparametrik Lanjutan](#uji-statistik-parametrik-dan-nonparametrik-lanjutan) |
| 2 | Analisis faktor | Aura Putri Maharani (222212526) | [Analisis Faktor](#analisis-faktor) |
| 3 | GLM multivariate dan repeated measures | Muhammad Ilham Cahyanto (222212756) | [GLM Multivariate dan Repeated Measures](#glm-multivariate-dan-repeated-measures) |
| 4 | Time series | Esra Yosefa Simarmata (222212585) | [Analisis Time Series Lanjutan](#analisis-time-series-lanjutan) |
| 5 | Regresi logistik biner | Dwinanda Muhammad Keyzha (222212576) | [Regresi Logistik Biner](#regresi-logistik-biner) |
| 6 | Regresi ordinal | Sofia Nur Afifah Rahayu (222212887) | [Regresi Ordinal](#regresi-ordinal) |
| 7 | Regresi logistik multinomial | Willy Sumbayak (222212916) | [Regresi Logistik Multinomial](#regresi-logistik-multinomial) |
| 8 | Analisis diskriminan | Muhammad Zacky Heta Warman (222212775) | [Analisis Diskriminan](#analisis-diskriminan) |
| 9 | Nearest neighbor | Louista Thania Harahap (222212707) | [Nearest Neighbor](#nearest-neighbor) |
| 10 | K-medoids | Bela Novita Sari (222212534) | [K-Medoids](#k-medoids) |
| 11 | Text analytics | Yedija Lewi Suryadi (222212921) | [Text Analytics](#text-analytics) |

---

## Regresi Logistik Biner

**Nama**             : Dwinanda Muhammad Keyzha  
**NIM**              : 222212576  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK MODUL REGRESI LOGISTIK BINER  
**Dosen Pembimbing** : Erna Nurmawati, S.S.T., M.T.  

### Deskripsi singkat

Modul ini menyediakan analisis regresi logistik untuk variabel dependen biner (dua kategori). Estimasi parameter memakai *iteratively reweighted least squares* (IRLS) yang dihitung dengan Rust/WebAssembly di browser, jadi data tidak dikirim ke server. Hasil dibandingkan dengan keluaran SPSS dan R pada ketelitian tiga desimal.

### Cara mengakses

Menu **Analyze > Regression > Binary Logistic...** membuka dialog dengan lima tab:

| Tab | Fungsi |
|---|---|
| Variables | Memilih variabel dependen, kovariat, dan metode seleksi |
| Categorical | Menentukan kovariat kategorik beserta kontras dan kategori referensinya |
| Save | Menyimpan hasil per kasus ke dataset |
| Options | Mengatur opsi keluaran dan kriteria estimasi |
| Assumption | Menjalankan uji asumsi |

### Fitur

- **Metode seleksi variabel**: Enter, Forward (Conditional, LR, Wald), dan Backward (Conditional, LR, Wald).
- **Variabel kategorik**: kontras dan kategori referensi dapat diatur per variabel.
- **Opsi**: selang kepercayaan untuk Exp(B), cut value klasifikasi, jumlah iterasi maksimum, probabilitas entry dan removal, konstanta, Hosmer-Lemeshow, classification plot, casewise listing, iteration history, correlations of estimates, serta tampilan pada setiap step atau step terakhir.
- **Save**: predicted probabilities, predicted group, residual (unstandardized, logit, studentized, standardized, deviance), dan ukuran pengaruh (Cook's distance, leverage, DfBeta).
- **Uji asumsi**: multikolinearitas (VIF/GVIF) dan linearitas logit (Box-Tidwell).
- **Log analisis**: setiap eksekusi mencatat sintaks bergaya SPSS.

### Keluaran

Tabel dan catatan kaki mengikuti format SPSS:

- Case Processing Summary, Dependent Variable Encoding, dan Categorical Variables Codings.
- **Block 0** (Beginning Block).
- **Block 1**: Omnibus Tests of Model Coefficients, Model Summary (-2 Log likelihood, Cox & Snell R Square, Nagelkerke R Square), Classification Table, Variables in the Equation, Variables not in the Equation, dan Step Summary untuk metode stepwise.
- Hosmer and Lemeshow Test, Iteration History, Correlation Matrix of Estimates, Classification Plot, serta Casewise List.
- Peringatan estimasi bila terdeteksi: separasi (lengkap atau kuasi) dan matriks Hessian yang hampir singular.
- Tabel uji asumsi (VIF/GVIF dan Box-Tidwell).

Setiap tabel disertai interpretasi singkat.

### Alur kerja

```
dialogs/BinaryLogisticMain.tsx            Mengumpulkan variabel dan opsi
        |
public/workers/Regression/binaryLogistic.worker.js
        |                                 Menghapus kasus tidak lengkap, mengodekan kovariat,
        |                                 lalu memanggil WASM
rust/ (crate statify-logistic)            IRLS, strategi seleksi, uji Wald/Score/LR,
        |                                 Hosmer-Lemeshow, uji asumsi
services/formatter*.ts                    Menyusun tabel gaya SPSS dan interpretasi
        |
IndexedDB -> halaman Result               Log, analytic, dan statistic disimpan lalu ditampilkan
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Regression/BinaryLogistic/`

```
BinaryLogistic/
├── dialogs/
│   ├── BinaryLogisticMain.tsx        # Dialog utama, orkestrasi worker, simpan hasil
│   ├── VariablesTab.tsx
│   ├── CategoricalTab.tsx
│   ├── SaveTab.tsx
│   ├── OptionsTab.tsx
│   └── AssumptionChecksTab.tsx
├── hooks/
│   └── tourConfig.ts                 # Konfigurasi tur fitur
├── services/
│   ├── formatter.ts                  # Entry point pemformat hasil
│   ├── formatter_block0.ts           # Tabel Block 0
│   ├── formatter_block1.ts           # Tabel Block 1 (Omnibus, Model Summary, dst.)
│   ├── formatter_hosmer.ts
│   ├── formatter_classification_plot.ts
│   ├── formatter_casewise.ts
│   ├── formatter_correlation_estimates.ts
│   ├── formatter_iteration_history.ts
│   ├── formatter_step_summary.ts
│   ├── formatter_assumptions.ts      # VIF/GVIF dan Box-Tidwell
│   ├── formatter_warnings.ts
│   ├── formatter_summary.ts
│   ├── formatter_utils.ts            # Format angka, p-value, dan teks interpretasi
│   └── syntaxGenerator.ts            # Log sintaks bergaya SPSS
├── types/
│   └── binary-logistic.ts            # Tipe opsi, hasil worker, dan section output
└── rust/                             # Crate Rust -> WebAssembly
    └── src/
        ├── lib.rs                    # Fungsi yang diekspor ke JavaScript
        ├── models/                   # config.rs, result.rs
        ├── stats/                    # irls, design_matrix, wald, score_test, hosmer_lemeshow,
        │                             # classification_plot, casewise, saved_predictions,
        │                             # correlation_of_estimates, assumptions, metrics, table
        ├── strategies/               # enter, forward_*, backward_*
        └── utils/                    # conversion, math, probability
```

File pendukung di luar folder modul:

| File | Fungsi |
|---|---|
| `frontend/public/workers/Regression/binaryLogistic.worker.js` | Web Worker yang menyiapkan data dan memanggil WASM |
| `frontend/public/workers/Regression/Binary/pkg/` | Paket WASM hasil build yang dibaca worker |
| `frontend/components/Modals/ModalRegistry.tsx` | Mendaftarkan dialog ke sistem modal |
| `frontend/app/help/components/statistics-guide/binary-logistic/` | Panduan penggunaan di halaman Help |

### Build ulang WASM

Lakukan hanya bila kode Rust berubah.

```bash
cd frontend/components/Modals/Analyze/Regression/BinaryLogistic/rust
cargo test                       # unit test
wasm-pack build --target web     # menulis ke rust/pkg
```

Setelah itu salin lima berkas dari `rust/pkg` ke `frontend/public/workers/Regression/Binary/pkg/`:

- `statify_logistic_bg.wasm`
- `statify_logistic.js`
- `statify_logistic.d.ts`
- `statify_logistic_bg.wasm.d.ts`
- `package.json`

Worker hanya membaca salinan ini, jadi bila langkah penyalinan terlewat, tampilan akan tetap memakai angka dari versi lama. Berkas `logistic_wasm*` di folder tujuan adalah sisa versi lama dan tidak dipakai worker.

### Pengujian

- **Unit test Rust** (`cargo test` di folder `rust/`): 27 test pada `stats/assumptions.rs`, `casewise.rs`, `classification_plot.rs`, `correlation_of_estimates.rs`, dan `saved_predictions.rs`.
- **Perbandingan dengan SPSS dan R**: hasil model, uji, dan diagnostik dibandingkan dengan keluaran SPSS dan R pada tiga desimal.

### Dokumentasi

- Panduan di dalam aplikasi: halaman **Help**, bagian Binary Logistic Regression.

---

## Regresi Logistik Multinomial

**Nama**             : Willy Sumbayak  
**NIM**              : 222212916  
**Judul Skripsi**    : PENGEMBANGAN MODUL REGRESI LOGISTIK MULTINOMIAL PADA APLIKASI STATIFY  
**Dosen Pembimbing** : Dr. Achmad Syahrul Choir, S.S.T., M.Si.  

### Deskripsi singkat

Modul ini menyediakan analisis regresi logistik untuk variabel dependen nominal dengan lebih dari dua kategori (model *baseline-category logit*). Parameter diestimasi dengan metode *maximum likelihood* melalui Newton-Raphson dengan *step-halving*. Perhitungan berjalan dengan Rust/WebAssembly di browser, jadi data tidak dikirim ke server. Format keluaran mengikuti prosedur NOMREG pada SPSS.

### Cara mengakses

Menu **Analyze > Regression > Multinomial Logistic...** membuka dialog dengan lima tab:

| Tab | Fungsi |
|---|---|
| Variables | Memilih variabel dependen, faktor (*fixed*), dan kovariat |
| Statistics | Memilih statistik dan tabel yang ditampilkan |
| Criteria | Mengatur kriteria iterasi dan konvergensi |
| Options | Mengatur kategori referensi, skala dispersi, opsi stepwise, dan hierarki |
| Save | Menyimpan hasil per kasus ke dataset |

### Fitur

- **Kategori referensi**: kategori pertama, terakhir, atau kustom.
- **Criteria**: iterasi maksimum, konvergensi parameter, konvergensi log-likelihood, kriteria singularitas, dan delta untuk sel kosong.
- **Options**: skala dispersi (None, User defined, Pearson, Deviance), probabilitas dan uji entry/removal (Likelihood ratio atau Score), serta aturan hierarki.
- **Statistics**: Pseudo R-square, Step summary, Model fitting information, Information criteria, Cell probabilities, Classification table, Goodness-of-fit, Monotonicity measures, Estimates, Likelihood ratio tests, Asymptotic correlations, dan Asymptotic covariances.
- **Save**: estimated response probabilities, predicted category, predicted category probability, dan probabilitas kategori aktual.

### Keluaran

Tabel mengikuti format SPSS:

- Case Processing Summary.
- Model Fitting Information (-2 Log likelihood, Chi-square, AIC, BIC).
- Goodness-of-Fit (Pearson dan Deviance).
- Pseudo R-Square (Cox & Snell, Nagelkerke, McFadden).
- Likelihood Ratio Tests per efek.
- Parameter Estimates (B, Std. Error, Wald, df, Sig., Exp(B), dan selang kepercayaan) untuk setiap kategori non-referensi.
- Classification Table, Observed and Predicted Frequencies (cell probabilities), serta matriks korelasi dan kovarians asimtotik.

Setiap tabel disertai interpretasi singkat (`dialogs/interpretations.ts`).

### Alur kerja

```
dialogs/MultinomialLogisticMain.tsx       Mengumpulkan variabel dan opsi
        |
public/workers/Regression/multinomialLogistic.worker.js
        |                                 Menyiapkan data lalu memanggil WASM
wasm/ (crate statify-multinomial)         Design matrix, Newton-Raphson, log-likelihood,
        |                                 Wald, LR test, goodness-of-fit, klasifikasi
dialogs/interpretations.ts                Interpretasi tabel
        |
IndexedDB -> halaman Result               Log, analytic, dan statistic disimpan lalu ditampilkan
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Regression/MultinomialLogistic/`

```
MultinomialLogistic/
├── ALGORITMA_DAN_RUMUS.md            # Dokumentasi algoritma dan rumus
├── diagrams/                         # Diagram alur modul
├── dialogs/
│   ├── MultinomialLogisticMain.tsx   # Dialog utama, orkestrasi worker, simpan hasil
│   ├── VariablesTab.tsx
│   ├── StatisticsTab.tsx
│   ├── CriteriaTab.tsx
│   ├── OptionsTab.tsx
│   ├── SaveTab.tsx
│   └── interpretations.ts            # Teks interpretasi hasil
├── hooks/
│   └── tourConfig.ts                 # Konfigurasi tur fitur
└── wasm/                             # Crate Rust -> WebAssembly
    ├── multinomialLogistic.worker.ts
    └── src/
        ├── lib.rs                    # Fungsi yang diekspor ke JavaScript
        ├── models/                   # config.rs, result.rs
        └── stats/                    # core, estimation, newton_raphson, probabilities,
                                      # log_likelihood, likelihood_ratio, goodness_of_fit,
                                      # classification, cell_probabilities, format_results
```

File pendukung di luar folder modul:

| File | Fungsi |
|---|---|
| `frontend/public/workers/Regression/multinomialLogistic.worker.js` | Web Worker yang menyiapkan data dan memanggil WASM |
| `frontend/public/workers/Regression/Multinomial/pkg/` | Paket WASM hasil build yang dibaca worker |
| `frontend/components/Modals/ModalRegistry.tsx` | Mendaftarkan dialog ke sistem modal |
| `frontend/app/help/components/statistics-guide/multinomial-logistic/` | Panduan penggunaan di halaman Help |

### Build ulang WASM

Lakukan hanya bila kode Rust berubah.

```bash
cd frontend/components/Modals/Analyze/Regression/MultinomialLogistic/wasm
cargo test                       # unit test
wasm-pack build --target web     # menulis ke wasm/pkg
```

Setelah itu salin berkas `statify_multinomial*` dan `package.json` dari `wasm/pkg` ke `frontend/public/workers/Regression/Multinomial/pkg/`. Worker hanya membaca salinan ini.

### Pengujian

- **Unit test Rust** (`cargo test` di folder `wasm/`).
- **Perbandingan dengan SPSS**: estimasi parameter, uji model, dan goodness-of-fit dibandingkan dengan keluaran SPSS NOMREG.

### Dokumentasi

- Dokumentasi algoritma dan rumus: [ALGORITMA_DAN_RUMUS.md](frontend/components/Modals/Analyze/Regression/MultinomialLogistic/ALGORITMA_DAN_RUMUS.md).
- Panduan di dalam aplikasi: halaman **Help**, bagian Multinomial Logistic Regression.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## GLM Multivariate dan Repeated Measures

**Nama**             : Muhammad Ilham Cahyanto  
**NIM**              : 222212756  
**Judul Skripsi**    : PENGEMBANGAN MODUL PEMODELAN LINIER PEUBAH GANDA DAN PENGUKURAN BERULANG PADA APLIKASI STATIFY  
**Dosen Pembimbing** : Firdaus, M.B.A.  

### Deskripsi singkat

Modul ini menambahkan dua prosedur General Linear Model (GLM) ke Statify:

- **GLM Multivariate** menganalisis lebih dari satu variabel dependen sekaligus. Prosedur ini mencakup MANOVA satu dan dua arah, MANCOVA, uji vektor rata-rata satu populasi, dua populasi, dan berpasangan (Hotelling's T²), serta uji khi-kuadrat bila matriks kovarians populasi Σ diketahui.
- **GLM Repeated Measures** menganalisis data yang diukur berulang pada subjek yang sama. Prosedur ini mencakup desain within-subjects, desain campuran (within dan between), desain dengan kovariat, dan desain *doubly multivariate* (lebih dari satu measure), lengkap dengan uji sferisitas Mauchly dan koreksi epsilon.

Kedua prosedur dihitung dengan Rust/WebAssembly di dalam Web Worker, jadi data tidak dikirim ke server dan tampilan tidak membeku saat perhitungan berjalan. Keluaran mengikuti prosedur GLM pada SPSS dan sudah divalidasi terhadap keluaran IBM SPSS Statistics 27 dengan toleransi 0,001.

### Cara mengakses

**GLM Multivariate**: menu **Analyze > General Linear Model > Multivariate...** membuka dialog dengan panel variabel dan tombol subdialog:

| Bagian | Fungsi |
|---|---|
| Variabel | Memilih Dependent Variables, Fixed Factor(s), Covariate(s), dan WLS Weight |
| Model | Full factorial atau model kustom, jenis Sum of Squares (Type I–IV), intercept |
| Contrasts | Kontras per faktor: Deviation, Simple, Difference, Helmert, Repeated, Polynomial |
| Post Hoc | Perbandingan berganda LSD, Bonferroni, dan Sidak |
| EM Means | Estimated marginal means dan perbandingan efek utama (LSD, Bonferroni, Sidak) |
| Save | Nilai prediksi, residual, leverage, dan statistik koefisien |
| Options | Statistik yang ditampilkan, uji homogenitas, selang kepercayaan simultan, taraf signifikansi |
| Bootstrap | Selang kepercayaan bootstrap (percentile dan BCa), sampling sederhana atau berstrata |
| Test Values | Nilai uji μ₀ untuk uji vektor rata-rata satu populasi |
| Paired | Pasangan variabel untuk Hotelling's T² berpasangan, dengan nilai uji δ₀ |
| Covariance Matrices | Muncul bila ada satu faktor dengan dua level. Pilihan Equal (Σ gabungan) atau Unequal (Welch-Satterthwaite), serta Test Values (δ₀) untuk uji dua populasi |

Subdialog Test Values, Test Values (δ₀), dan Paired juga menyediakan isian matriks kovarians Σ yang diketahui.

**GLM Repeated Measures**: menu **Analyze > General Linear Model > Repeated Measures...** memakai alur dua tahap:

1. **Define**: menentukan nama faktor within-subjects, jumlah levelnya, dan nama measure.
2. **Dialog utama**: memetakan variabel dataset ke setiap sel (level × measure), lalu memilih Between-Subjects Factor(s) dan Covariate(s). Tombol **Back to Define** kembali ke tahap pertama.

| Bagian | Fungsi |
|---|---|
| Model | Full factorial atau model kustom untuk efek within dan between, dengan Sum of Squares Type III |
| Contrasts | Kontras faktor within-subjects: Polynomial (bawaan, sama dengan SPSS) atau Repeated |
| EM Means | Estimated marginal means dan perbandingan berpasangan (LSD, Bonferroni, Sidak) |
| Save | Nilai prediksi, residual, leverage, dan statistik koefisien |
| Options | Statistik yang ditampilkan, uji homogenitas, taraf signifikansi |

Plots (kedua prosedur) dan Post Hoc (Repeated Measures) belum didukung di versi ini, dan tombolnya dinonaktifkan. Untuk perbandingan berpasangan pada Repeated Measures, gunakan EM Means > Compare main effects.

### Fitur

**GLM Multivariate**

- **Desain**: MANOVA satu dan dua arah, MANCOVA, model kustom (misalnya model efek utama tanpa interaksi), dan analisis berbobot (WLS). Sum of Squares Type I sampai IV, termasuk penanganan sel kosong pada Type IV.
- **Uji vektor rata-rata (Hotelling's T²)**:
  - satu populasi, dengan nilai uji μ₀;
  - dua populasi, dengan nilai uji δ₀ dan pilihan matriks kovarians sama (Σ gabungan) atau tidak sama (Welch-Satterthwaite, df pecahan);
  - berpasangan, dengan nilai uji δ₀. Kolom selisih d = v₁ − v₂ dibentuk otomatis.
- **Σ diketahui**: uji khi-kuadrat untuk satu populasi, dua populasi, dan berpasangan. Matriks yang dimasukkan diperiksa (diagonal positif dan definit positif) sebelum analisis dijalankan.
- **Selang kepercayaan simultan**: T² dan Bonferroni; untuk kasus Unequal memakai Krishnamoorthy–Yu dan Welch t.
- **Uji multivariat**: Pillai's Trace, Wilks' Lambda, Hotelling's Trace, dan Roy's Largest Root, beserta partial eta squared, noncentrality, dan observed power.
- **Analisis lanjutan**: kontras, post hoc, EM means, dan bootstrap.

**GLM Repeated Measures**

- **Desain**: within-subjects murni, campuran within × between, dengan kovariat, dan *doubly multivariate*.
- **Sferisitas**: uji Mauchly beserta epsilon Greenhouse-Geisser, Huynh-Feldt, dan Lower-bound. Epsilon mengoreksi df pada Tests of Within-Subjects Effects.
- **Uji multivariat** untuk efek within-subjects (Pillai, Wilks, Hotelling, Roy).
- **Kontras within-subjects** Polynomial dan Repeated, serta EM means dengan perbandingan berpasangan.

**Keduanya**

- Statistik deskriptif, uji homogenitas (Box's M, Levene, Bartlett's test of sphericity), estimasi parameter, matriks SSCP, *general estimable function*, ukuran efek, dan observed power.
- Penyimpanan nilai prediksi, residual, dan leverage ke dataset.
- Tur fitur interaktif di dalam dialog.
- Pesan galat yang jelas bila data atau pengaturan tidak memenuhi syarat analisis.

### Keluaran

Tabel dan catatan kaki mengikuti format SPSS.

**GLM Multivariate**

- Between-Subjects Factors dan Descriptive Statistics.
- Box's Test of Equality of Covariance Matrices, Bartlett's Test of Sphericity, dan Levene's Test of Equality of Error Variances.
- **Multivariate Tests**, ditambah Chi-Square Test (Known Covariance Matrix) bila Σ diketahui.
- Simultaneous Confidence Intervals (T² dan Bonferroni, atau versi Σ diketahui).
- Tests of Between-Subjects Effects dan Parameter Estimates.
- Between-Subjects SSCP Matrix, Residual SSCP Matrix, dan General Estimable Function.
- Contrast Results (K Matrix) beserta uji multivariat dan univariatnya, Estimated Marginal Means, dan Multiple Comparisons.

**GLM Repeated Measures**

- Within-Subjects Factors dan Descriptive Statistics.
- Box's M, Levene, dan Bartlett.
- Multivariate Tests untuk efek within-subjects.
- **Mauchly's Test of Sphericity** (W, Approx. Chi-Square, df, Sig., dan tiga epsilon).
- **Tests of Within-Subjects Effects** dengan empat baris per efek (Sphericity Assumed, Greenhouse-Geisser, Huynh-Feldt, Lower-bound).
- Tests of Within-Subjects Contrasts dan Tests of Between-Subjects Effects.
- Parameter Estimates, matriks SSCP, Estimated Marginal Means, Pairwise Comparisons, dan Univariate Tests.

### Alur kerja

```
dialogs/*-main.tsx                        Mengumpulkan variabel dan opsi, disimpan di IndexedDB
        |
services/*-analysis.ts                    Memotong data, membuang kasus tidak lengkap, menyusun payload
        |                                 (RM: memetakan variabel ke sel level x measure; MV: kolom
        |                                 selisih untuk Paired, validasi matriks Sigma)
services/*-analysis-worker.ts             Web Worker yang memuat WASM dari rust/pkg
        |
rust/ (crate wasm per modul)              Design matrix, Sum of Squares Type I-IV, uji multivariat,
        |                                 Mauchly dan epsilon (RM), Hotelling T2 dan Sigma diketahui (MV)
services/*-analysis-formatter.ts          Menyusun tabel gaya SPSS beserta catatan kaki
        |
IndexedDB -> halaman Result               Log, analytic, dan statistic disimpan lalu ditampilkan
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/general-linear-model/`

```
general-linear-model/
├── multivariate/
│   ├── README.md, architecture.md, development-step.md   # Dokumentasi teknis modul
│   ├── constants/                    # Nilai bawaan dialog dan daftar metode
│   ├── dialogs/
│   │   ├── multivariate-main.tsx     # Container: orkestrasi worker dan simpan hasil
│   │   ├── dialog.tsx                # Dialog utama dan panel Covariance Matrices
│   │   ├── model.tsx, contrast.tsx, posthoc.tsx, emmeans.tsx,
│   │   │   save.tsx, options.tsx, bootstrap.tsx, plots.tsx
│   │   ├── test-values.tsx           # Nilai uji mu0 (satu populasi)
│   │   ├── two-sample-delta.tsx      # Nilai uji delta0 (dua populasi)
│   │   ├── paired.tsx                # Hotelling's T2 berpasangan
│   │   └── known-sigma-matrix.tsx    # Isian matriks Sigma diketahui
│   ├── hooks/                        # tourConfig.ts, useTourGuide.ts
│   ├── services/
│   │   ├── multivariate-analysis.ts            # Menyiapkan payload dan menjalankan worker
│   │   ├── multivariate-analysis-worker.ts     # Web Worker
│   │   ├── multivariate-analysis-formatter.ts  # Tabel gaya SPSS
│   │   ├── multivariate-analysis-output.ts     # Menyimpan hasil ke halaman Result
│   │   ├── paired-difference.ts      # Kolom selisih untuk uji berpasangan
│   │   ├── two-sample-delta.ts       # Uji dua populasi dengan delta0
│   │   ├── known-sigma.ts            # Validasi dan uji khi-kuadrat Sigma diketahui
│   │   └── empty-cells.ts            # Penanganan sel kosong
│   ├── types/
│   ├── test/, __test__/              # Jest (unit, acuan SPSS, performa)
│   └── rust/                         # Crate Rust -> WebAssembly
│       ├── pkg/                      # Hasil build yang dimuat worker
│       └── src/
│           ├── lib.rs
│           ├── models/               # config, data, result
│           ├── stats/                # core, multivariate_tests, between_subjects_effects,
│           │                         # box_m_test, levene_test, bartlett_test, sscp_matrix,
│           │                         # parameter_estimates, emmeans, posthoc, bootstrap, ...
│           ├── wasm/                 # constructor.rs, function.rs (API ke JavaScript)
│           ├── utils/
│           └── test/                 # Validasi Rust terhadap nilai SPSS
├── repeated-measures/
│   ├── README.md, architecture.md, development-step.md
│   ├── constants/
│   ├── dialogs/
│   │   ├── define/                   # Tahap Define: faktor within, level, measure
│   │   ├── repeated-measures-main.tsx
│   │   ├── dialog.tsx                # Dialog utama dan pemetaan sel level x measure
│   │   └── model.tsx, contrast.tsx, emmeans.tsx, save.tsx, options.tsx,
│   │       posthoc.tsx, plots.tsx
│   ├── hooks/
│   ├── services/                     # analysis, worker, formatter, output
│   ├── types/
│   ├── __test__/                     # Jest (struktur keluaran, acuan SPSS, performa)
│   └── rust/
│       ├── pkg/
│       └── src/
│           ├── stats/                # rm_model, mauchly_test, within_subjects_effects,
│           │                         # multivariate_tests, parse_factors, glm_tests,
│           │                         # between_subjects_effects, emmeans, ...
│           ├── wasm/, models/, utils/
│           └── test/
└── shared/                           # Dipakai MV dan RM: eksekusi GLM, kolom effect size,
                                      # catatan kaki SPSS, pesan galat
```

File pendukung di luar folder modul:

| File | Fungsi |
|---|---|
| `frontend/components/Modals/Analyze/general-linear-model/GeneralLinearModelRegistry.tsx` | Mendaftarkan dialog Multivariate dan Repeated Measures ke sistem modal |
| `frontend/components/Modals/Analyze/general-linear-model/general-linear-model-menu.tsx` | Entri menu Analyze > General Linear Model |
| `frontend/app/help/components/statistics-guide/multivariate/` | Panduan penggunaan GLM Multivariate di halaman Help |
| `frontend/app/help/components/statistics-guide/repeated-measures/` | Panduan penggunaan GLM Repeated Measures di halaman Help |

### Build ulang WASM

Lakukan hanya bila kode Rust berubah. Build final skripsi memakai rustc 1.95.0 dan wasm-pack 0.14.0.

```bash
cd frontend/components/Modals/Analyze/general-linear-model/multivariate/rust
cargo test --lib                 # unit test dan validasi
wasm-pack build --target web     # menulis ke rust/pkg

cd ../../repeated-measures/rust
cargo test --lib
wasm-pack build --target web
```

Berbeda dengan modul yang memakai `public/workers/`, worker GLM di-bundle oleh Next.js dan memuat WASM langsung dari `rust/pkg`. Karena itu, hasil build tidak perlu disalin ke folder lain. Commit berkas di `rust/pkg/` (`wasm_bg.wasm`, `wasm.js`, `wasm.d.ts`, `wasm_bg.wasm.d.ts`, `package.json`) beserta `Cargo.lock` kedua crate.

### Pengujian

- **Unit test Rust** (`cargo test --lib` di folder `rust/` masing-masing), termasuk validasi terhadap nilai SPSS dan pengujian jalur dasar (*basis path*).
- **Jest** dari folder `frontend/`. Jalankan secara serial karena setiap suite memuat WASM:

  ```bash
  npx jest --runInBand general-linear-model/multivariate general-linear-model/repeated-measures general-linear-model/shared
  ```

  Suite `repeated-measures-reference.test.ts` membaca dataset dari `testing/glm-rm-reference/data/`. Data ini tersedia di branch `ilham`, tetapi sudah dihapus dari `main`. Di `main`, ambil dulu datanya dari commit build final, lalu jalankan Jest. Hasilnya 14 suite lulus, dengan 4.080 test lulus dan 12 test berstatus *todo*:

  ```bash
  git restore --source=3552b5dc -- testing/glm-rm-reference/data
  ```

- **Validasi numerik terhadap SPSS 27**, dengan toleransi |Statify − SPSS| ≤ 0,001:
  - **Multivariate**: 9 konfigurasi. Konfigurasinya adalah satu populasi, dua populasi, berpasangan, MANOVA satu arah beserta post hoc, MANOVA dua arah dengan dan tanpa interaksi, data tak seimbang, dan data dengan nilai hilang. Sebanyak 2.339 nilai yang punya padanan di Statify semuanya lulus.
  - **Repeated Measures**: 4 dataset (within-only dua measure, dua desain campuran, dan dataset Gambar 51). Sebanyak 1.047 nilai cocok.
- **Black-box**: 78 skenario pada build final, semuanya sesuai.
- **White-box**: *basis path testing* dan *code coverage* pada inti Rust dan services TypeScript, dengan nilai harapan dari SPSS 27 atau R 4.3.2.

Data, sintaks SPSS, keluaran SPSS, harness, dan laporan pengujian tersimpan di folder `testing/` pada commit build final [`3552b5dc`](https://git.stis.ac.id/222212887/statify64/-/tree/3552b5dc5a02743ff9466a32454cc9dc546b1335/testing). Folder ini sudah tidak ada di `main`. Isinya antara lain:

- `glm-mv-reference/` dan `glm-rm-reference/`: validasi terhadap SPSS;
- `black-box/`: skenario dan hasil eksekusi;
- `whitebox/`: laporan white-box v6.

### Dokumentasi

- Dokumentasi teknis (arsitektur, alur data, algoritma): [multivariate/architecture.md](frontend/components/Modals/Analyze/general-linear-model/multivariate/architecture.md) dan [repeated-measures/architecture.md](frontend/components/Modals/Analyze/general-linear-model/repeated-measures/architecture.md), serta README di masing-masing folder modul.
- Panduan di dalam aplikasi: halaman **Help**, bagian GLM Multivariate dan GLM Repeated Measures.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Analisis Diskriminan

**Nama**             : Muhammad Zacky Heta Warman  
**NIM**              : 222212775  
**Judul Skripsi**    : PENGEMBANGAN MODUL ANALISIS DISKRIMINAN PADA APLIKASI STATISTIK STATIFY  
**Dosen Pembimbing** : Firdaus, M.B.A.  

### Deskripsi singkat

Modul ini menyediakan analisis diskriminan untuk satu variabel pengelompokan kategorik dan sejumlah variabel bebas numerik. Analisis membentuk fungsi diskriminan kanonik, yaitu kombinasi linear variabel bebas yang paling memisahkan kelompok. Fungsi itu dipakai untuk dua tujuan sekaligus: menjelaskan variabel mana yang membedakan kelompok, dan mengklasifikasikan kasus ke salah satu kelompok. Jumlah fungsi yang terbentuk paling banyak min(jumlah kelompok − 1, jumlah variabel bebas).

Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker, jadi data tidak dikirim ke server. Keluaran mengikuti prosedur DISCRIMINANT pada SPSS, termasuk format angka dan catatan kakinya.

### Cara mengakses

Menu **Analyze > Classify > Discriminant...** membuka dialog dengan tab berikut:

| Tab | Fungsi |
|---|---|
| Variables | Memilih metode (Enter independents together atau Use stepwise method), Grouping Variable beserta Define Range, Independents, dan Selection Variable (opsional) |
| Statistics | Statistik deskriptif, koefisien fungsi, dan matriks |
| Method | Hanya muncul pada metode stepwise. Mengatur kriteria seleksi variabel dan tampilan langkah |
| Classify | Prior probabilities, matriks kovarians untuk klasifikasi, tabel klasifikasi, dan plot |
| Save | Menyimpan hasil per kasus ke dataset dan mengekspor model ke XML |
| Bootstrap | Hanya muncul pada metode Enter independents together. Mengatur bootstrap untuk koefisien terstandarisasi |
| Assumptions | Menjalankan uji asumsi secara terpisah dari analisis utama |

Ikon **?** di pojok kiri bawah dialog menjalankan tur fitur yang menyorot setiap bagian dialog secara berurutan. Pengaturan dialog tersimpan otomatis untuk pembukaan berikutnya.

### Fitur

- **Metode**: semua variabel bebas dimasukkan sekaligus (Together), atau seleksi bertahap (Stepwise).
- **Kriteria stepwise**: Wilks' Lambda, Unexplained Variance, Mahalanobis Distance, Smallest F Ratio, dan Rao's V (dengan V-to-enter). Batas masuk dan keluar memakai nilai F atau probabilitas F. Opsi tampilan mencakup ringkasan langkah dan F untuk jarak antarpasangan kelompok.
- **Statistics**:
  - Descriptives: Means dan Univariate ANOVAs (uji kesamaan rata-rata kelompok), serta Box's M.
  - Function Coefficients: Fisher's (fungsi klasifikasi) dan Unstandardized.
  - Matrices: korelasi dan kovarians within-groups, kovarians separate-groups, dan kovarians total.
- **Classify**:
  - Prior probabilities: sama untuk semua kelompok atau dihitung dari ukuran kelompok.
  - Matriks kovarians: within-groups (gabungan) atau separate-groups.
  - Casewise results dengan batas jumlah kasus, summary table, dan klasifikasi *leave-one-out* (validasi silang).
  - Plot combined-groups, separate-groups, dan territorial map.
  - Penggantian nilai hilang dengan rata-rata.
- **Selection Variable dan Generate Split**: fungsi diestimasi hanya dari kasus terpilih, sedangkan kasus lain tetap diklasifikasikan dan dilaporkan terpisah. Tombol **Generate Split...** membuat variabel baru 1 = training dan 0 = testing (bawaan 70% training, seed 2000000, dapat berstrata), lalu menjadikannya Selection Variable.
- **Save**: kelompok prediksi (`Dis_1`), skor diskriminan (`Dis1_1`, …), dan probabilitas keanggotaan tiap kelompok, mengikuti penamaan `DISCRIMINANT /SAVE` di SPSS. Model juga dapat diekspor ke berkas XML yang diunduh lewat browser.
- **Bootstrap**: jumlah sampel (bawaan 1000), seed Mersenne Twister (bawaan 2000000), selang kepercayaan Percentile atau BCa, serta sampling Simple atau Stratified. Hasilnya berupa bias, galat baku, dan selang kepercayaan untuk setiap koefisien terstandarisasi.
- **Uji asumsi** (tombol **Run Assumption Tests**, dapat dijalankan tanpa analisis lengkap): multikolinearitas (Tolerance dan VIF, batas VIF 10), normalitas multivariat Henze-Zirkler, dan normalitas univariat Anderson-Darling per kelompok. Homogenitas matriks kovarians diuji dengan Box's M dari tab Statistics.
- **Validasi input** sebelum data dikirim ke worker. Misalnya, Define Range wajib diisi, sama seperti `/GROUPS=var(min max)` di SPSS.
- **Interpretasi**: setiap tabel disertai uraian singkat (`services/discriminant-interpretation.ts`).

### Keluaran

Tabel, plot, dan catatan kaki mengikuti format SPSS:

- Analysis Case Processing Summary, Group Statistics, dan Tests of Equality of Group Means.
- Pooled Within-Groups Covariance dan Correlation Matrix, serta Covariance Matrices (separate-groups dan total).
- Log Determinants dan Test Results (Box's M).
- Untuk metode stepwise: Variables Entered/Removed, Variables in the Analysis, Variables Not in the Analysis, Wilks' Lambda per langkah, dan Pairwise Group Comparisons.
- Summary of Canonical Discriminant Functions:
  - Eigenvalues dan Wilks' Lambda;
  - Standardized Canonical Discriminant Function Coefficients dan Structure Matrix;
  - Canonical Discriminant Function Coefficients dan Functions at Group Centroids.
- Classification Statistics:
  - Classification Processing Summary dan Prior Probabilities for Groups;
  - Classification Function Coefficients;
  - Casewise Statistics (kasus salah klasifikasi ditandai `**`);
  - Classification Results, termasuk baris Cross-validated dan kasus testing bila ada Selection Variable.
- Plot: Combined-Groups Plot, Separate-Groups Plot, dan Territorial Map. Bila hanya terbentuk satu fungsi, plot ditampilkan sebagai histogram per kelompok.
- Hasil bootstrap koefisien terstandarisasi.
- Uji asumsi: Assumption Checks Summary, Multicollinearity (Tolerance and VIF), Multivariate Normality within Groups (Henze-Zirkler Test), dan Univariate Normality within Groups (Anderson-Darling).

### Alur kerja

```
dialogs/discriminant-main.tsx             Mengumpulkan variabel dan opsi (state di hooks/useDiscriminantState.ts)
        |
services/discriminant-validation.ts       Memeriksa input (Define Range, jumlah variabel, dst.)
        |
public/workers/Classify/Discriminant/discriminant.worker.js
        |                                 Memuat WASM dari ./pkg lalu membuat DiscriminantAnalysis
rust/ (crate wasm)                        Matriks SSCP, eigen, fungsi kanonik, seleksi stepwise,
        |                                 klasifikasi, leave-one-out, Box's M, bootstrap, uji asumsi
services/discriminant-analysis-formatter.ts
        |                                 Menyusun tabel dan plot gaya SPSS
services/store.ts                         Menambahkan interpretasi lalu menyimpan hasil
        |
IndexedDB -> halaman Result               Log, analytic, dan statistic disimpan lalu ditampilkan
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Classify/discriminant/`

```
discriminant/
├── constants/
│   └── discriminant-default.ts       # Nilai bawaan setiap tab
├── dialogs/
│   ├── discriminant-main.tsx         # Dialog utama, tab Variables, Generate Split, orkestrasi worker
│   ├── statistics.tsx
│   ├── method.tsx                    # Kriteria stepwise
│   ├── classify.tsx
│   ├── save.tsx                      # Save dan ekspor XML
│   ├── bootstrap.tsx
│   └── assumptions.tsx               # Tombol Run Assumption Tests
├── hooks/
│   ├── useDiscriminantState.ts       # State dialog dan payload ke engine
│   └── tourConfig.ts                 # Konfigurasi tur fitur
├── services/
│   ├── discriminant-analysis-formatter.ts  # Tabel dan plot gaya SPSS
│   ├── discriminant-interpretation.ts      # Teks interpretasi tiap tabel
│   ├── discriminant-number-format.ts       # Format angka mengikuti pivot table SPSS
│   ├── discriminant-validation.ts          # Validasi input sebelum dikirim ke worker
│   ├── discriminant-split.ts               # Variabel training/testing (Generate Split)
│   ├── discriminant-save.ts                # Variabel hasil Save ke dataset
│   ├── discriminant-xml-export.ts          # Ekspor model ke XML
│   ├── store.ts                            # Menyimpan hasil ke halaman Result
│   └── formatter.ts                        # Entry point formatter
├── types/
│   └── discriminant.ts
├── __tests__/
│   ├── integration/                  # Jest white-box: alur analisis, Generate Split, uji asumsi
│   │   └── fixtures/iris.csv
│   └── unit/                         # Test Rust white-box: eigen dan klasifikasi
└── rust/                             # Crate Rust -> WebAssembly
    ├── Cargo.toml
    └── src/
        ├── lib.rs
        ├── models/                   # config, data, result
        ├── stats/                    # core, basic_processing, matrix_calculation, group_statistics,
        │                             # equality_test, box_m_test, log_determinant,
        │                             # canonical_function, structure_matrix, classification_result,
        │                             # casewise_statistics, prior_probabilities, separate_covariance,
        │                             # stepwise_method, stepwise_statistics, variable_selection,
        │                             # pairwise_comparison, statistical_test, bootstrap, assumptions
        ├── wasm/                     # constructor.rs, function.rs (API ke JavaScript)
        └── utils/                    # converter, error, log
```

File pendukung di luar folder modul:

| File | Fungsi |
|---|---|
| `frontend/public/workers/Classify/Discriminant/discriminant.worker.js` | Web Worker yang memuat WASM dan menjalankan analisis |
| `frontend/public/workers/Classify/Discriminant/pkg/` | Paket WASM hasil build yang dibaca worker |
| `frontend/components/Modals/Analyze/Classify/ClassifyRegistry.tsx` | Mendaftarkan dialog ke sistem modal |
| `frontend/components/Modals/Analyze/Classify/classify-menu.tsx` | Entri menu Analyze > Classify |
| `frontend/app/help/components/statistics-guide/discriminant/` | Panduan penggunaan di halaman Help |

### Build ulang WASM

Lakukan hanya bila kode Rust berubah.

```bash
cd frontend/components/Modals/Analyze/Classify/discriminant/rust
cargo test                       # unit test, termasuk test white-box di ../__tests__/unit
wasm-pack build --target web     # menulis ke rust/pkg
```

Setelah itu salin `wasm_bg.wasm`, `wasm.js`, `wasm.d.ts`, `wasm_bg.wasm.d.ts`, dan `package.json` dari `rust/pkg` ke `frontend/public/workers/Classify/Discriminant/pkg/`. Worker hanya membaca salinan ini.

### Pengujian

- **Unit test Rust** (`cargo test` di folder `rust/`): 23 test, terdiri atas 2 test bootstrap di `src/`, 14 test klasifikasi, dan 7 test eigen di `__tests__/unit/`.
- **Integrasi white-box** dengan Jest dari folder `frontend/`, memakai data `iris.csv`: 3 suite dan 17 test untuk alur analisis, Generate Split, dan uji asumsi.

  ```bash
  npx jest --runInBand Classify/discriminant
  ```

- **Mode presisi** untuk mencocokkan angka dengan SPSS melebihi digit yang ditampilkan. Jalankan `localStorage.setItem("discriminant.decimals", "10")` di console browser, maka semua statistik dicetak dengan jumlah desimal tersebut (1–15). Judul keluaran menandai mode ini supaya tidak tertukar dengan keluaran biasa.

### Dokumentasi

- Panduan di dalam aplikasi: halaman **Help**, bagian Discriminant Analysis. Isinya mencakup variabel, metode stepwise, statistik, klasifikasi, save dan bootstrap, uji asumsi, serta cara membaca keluaran.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Uji Statistik Parametrik dan Nonparametrik Lanjutan

**Nama**             : Daniel Dabra Pasongli  
**NIM**              : 222212555  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK MODUL UJI STATISTIK PARAMETRIK DAN NONPARAMETRIK LANJUTAN  
**Dosen Pembimbing** : Siti Mariyah, S.S.T., M.T., Ph.D.  

### Deskripsi singkat

Modul ini menambahkan tiga kelompok uji ke menu yang sudah ada:

- **Uji normalitas**: Shapiro-Wilk dan Kolmogorov-Smirnov dengan koreksi signifikansi Lilliefors.
- **Uji Bartlett**: menguji homogenitas varians antarkelompok.
- **Uji Chi-Square untuk data kategorik**: uji kebebasan, serta uji kesamaan proporsi (binomial dan multinomial).

Berbeda dari sebagian besar modul lain, perhitungannya ditulis dalam JavaScript murni tanpa pustaka statistik eksternal. Perhitungan tetap berjalan di Web Worker, jadi data tidak dikirim ke server. Keluaran mengikuti format SPSS dan dilengkapi interpretasi otomatis pada setiap tabel.

### Cara mengakses

| Uji | Menu | Letak pengaturan |
|---|---|---|
| Normalitas | **Analyze > Descriptive Statistics > Explore...** | Tab Plots, centang **Normality plots with tests** |
| Bartlett | **Analyze > Compare Means > Bartlett's Test of Homogeneity...** | Tab Variables (Test Variables dan Factor Variable) dan tab Options |
| Chi-Square | **Analyze > Descriptive Statistics > Crosstabs...** | Tab Statistics, bagian **Chi-Square**, lalu pilih Tujuan Pengujian |

Setiap dialog dilengkapi tooltip penggunaan dan tur fitur.

### Fitur

- **Shapiro-Wilk**: algoritma Royston AS R94 (1995) dengan posisi plot Blom, untuk n = 3 sampai 5.000 (konvensi SPSS). Rumus nilai-p dipilih menurut ukuran sampel: eksak untuk n = 3, Royston (1993) untuk n ≤ 11, dan Royston (1995) untuk n > 11.
- **Kolmogorov-Smirnov**: dengan koreksi signifikansi Lilliefors. Nilai-p disamakan dengan R.
- **Bartlett**:
  - statistik khi-kuadrat dengan df = k − 1, untuk satu atau beberapa variabel uji terhadap satu faktor;
  - syarat: minimal 2 kelompok, masing-masing minimal 2 observasi;
  - statistik deskriptif per kelompok bersifat opsional.

  Uji ini berbeda dengan Bartlett's Test of Sphericity pada analisis faktor.
- **Chi-Square**:
  - statistik Pearson dipakai untuk dua tujuan: **Uji Kebebasan** (hubungan dua variabel kategorik) dan **Uji Kesamaan Proporsi** (binomial untuk dua kategori hasil, multinomial untuk tiga kategori atau lebih);
  - aturan expected count (syarat Cochran) diperiksa dan dilaporkan;
  - kategori teks dapat dipakai langsung tanpa recode;
  - penjumlahan memakai algoritma Neumaier supaya presisi terjaga.
- **Interpretasi**: hipotesis, keputusan pada α, dan kesimpulan ditulis di bagian Description setiap tabel.

### Keluaran

- **Tests of Normality**: kolom Kolmogorov-Smirnov dan Shapiro-Wilk (Statistic, df, Sig.), dengan catatan kaki Lilliefors Significance Correction.
- **Bartlett's Test of Homogeneity of Variances**: χ², df, dan Sig. Bila diminta, juga Descriptive Statistics per kelompok (N, Mean, Std. Deviation, Variance, Minimum, Maximum).
- **Crosstabs**: Case Processing Summary, tabel silang, dan **Chi-Square Tests** dengan catatan expected count.

### Alur kerja

```
Explore / BartlettTest / Crosstabs (React)        Mengumpulkan variabel dan opsi, memvalidasi input
        |
public/workers/DescriptiveStatistics/examine.worker.js    -> libs/normality/normalityTests.js
public/workers/CompareMeans/bartlettTestWorker.js
public/workers/DescriptiveStatistics/crosstabs.worker.js  -> libs/crosstabs/ dan libs/categoricalTests/
        |
utils/**/formatter.ts dan interpretation.ts       Menyusun tabel gaya SPSS dan interpretasi
        |
IndexedDB -> halaman Result                       Log, analytic, dan statistic disimpan lalu ditampilkan
```

### Struktur direktori

Kode modul tersebar di beberapa folder karena menempel pada menu yang sudah ada:

```
frontend/components/Modals/Analyze/
├── CompareMeans/BartlettTest/
│   ├── index.tsx                     # Dialog utama
│   ├── components/                   # VariablesTab, OptionsTab, BartlettInfo (tooltip)
│   ├── hooks/                        # useBartlettAnalysis, useVariableSelection, useTestSettings, tur
│   ├── utils/                        # formatters, interpretation, validation
│   └── __tests__/                    # unit, white-box, black-box
├── Descriptive/Explore/
│   ├── components/NormalityOptions.tsx
│   └── utils/normality/              # formatter.ts, interpretation.ts
├── Descriptive/Crosstabs/
│   ├── components/ChiSquareOptions.tsx
│   └── utils/chiSquare/              # formatter.ts, interpretation.ts, validation.ts
└── shared/statisticalOutput.ts       # Format keluaran statistik bersama

frontend/public/workers/
├── CompareMeans/bartlettTestWorker.js
└── DescriptiveStatistics/
    ├── examine.worker.js, crosstabs.worker.js
    └── libs/
        ├── normality/normalityTests.js       # Shapiro-Wilk dan Kolmogorov-Smirnov
        ├── categoricalTests/categoricalChiSquare.js
        └── crosstabs/crosstabs.js
```

### Build

Tidak ada kode Rust. Perubahan pada berkas JavaScript di `public/workers/` langsung dipakai aplikasi tanpa langkah build.

### Pengujian

- **Jest** dari folder `frontend/`: 36 suite, 476 test lulus dan 3 dilewati.

  ```bash
  npx jest --runInBand components/Modals/Analyze/CompareMeans/BartlettTest components/Modals/Analyze/Descriptive/Crosstabs/__tests__/chiSquare components/Modals/Analyze/Descriptive/Explore/__tests__/normality public/workers/DescriptiveStatistics/libs/normality public/workers/DescriptiveStatistics/libs/categoricalTests public/workers/CompareMeans/__tests__
  ```

- **Validasi terhadap SPSS 28** untuk uji normalitas: toleransi |W| < 0,0001 dan |p| < 0,001, dengan keputusan pada α = 0,05 harus sama. Datanya 15 dataset acuan (normal, seragam, dan eksponensial; n = 3 sampai 500) di `libs/normality/__tests__/spss-benchmark-csv/`.
- **Uji lain untuk normalitas**:
  - *property-based* dengan fast-check;
  - kinerja: n = 5.000 di bawah 500 ms;
  - memori dan integrasi worker.
- **White-box dan black-box** untuk Bartlett dan Chi-Square.

### Dokumentasi

- Uji normalitas: [README](frontend/public/workers/DescriptiveStatistics/libs/normality/README.md) dan [DEVELOPER_GUIDE](frontend/public/workers/DescriptiveStatistics/libs/normality/DEVELOPER_GUIDE.md).
- Uji Bartlett: [README](frontend/components/Modals/Analyze/CompareMeans/BartlettTest/README.md), termasuk rumusnya.
- Crosstabs dan Chi-Square: [README](frontend/public/workers/DescriptiveStatistics/libs/crosstabs/README.md), termasuk rumusnya.
- Panduan di dalam aplikasi: halaman **Help**, bagian Explore dan Crosstabs.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Analisis Faktor

**Nama**             : Aura Putri Maharani  
**NIM**              : 222212526  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK MODUL ANALISIS FAKTOR  
**Dosen Pembimbing** : Erna Nurmawati, S.S.T., M.T.  

### Deskripsi singkat

Modul ini menyediakan analisis faktor dan analisis komponen utama (*principal component analysis*). Keduanya meringkas banyak variabel yang saling berkorelasi menjadi sejumlah kecil faktor atau komponen. Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker, dan keluarannya mengikuti prosedur FACTOR pada SPSS.

### Cara mengakses

Menu **Analyze > Dimension Reduction > Factor...** membuka dialog dengan tab berikut:

| Tab | Fungsi |
|---|---|
| Variables | Memilih variabel yang dianalisis, serta Selection Variable beserta nilainya (opsional) |
| Descriptives | Statistik deskriptif dan statistik matriks korelasi |
| Extraction | Metode ekstraksi, matriks yang dianalisis, kriteria jumlah faktor, dan tampilan |
| Rotation | Metode rotasi dan tampilan hasil rotasi |
| Scores | Menyimpan skor faktor ke dataset dan menampilkan koefisien skor |
| Options | Penanganan nilai hilang dan format tampilan koefisien |

### Fitur

- **Descriptives**: Univariate Descriptives dan Initial Solution. Untuk matriks korelasi tersedia Coefficients, Significance Levels (satu arah, seperti SPSS), Determinant, KMO and Bartlett's Test of Sphericity, Inverse, Reproduced, dan Anti-image.
- **Extraction**:
  - metode Principal Components, Unweighted Least Squares, Generalized Least Squares, Maximum Likelihood, dan Principal Axis Factoring;
  - analisis matriks korelasi atau kovarians;
  - jumlah faktor ditentukan dari eigenvalue di atas batas tertentu, atau ditetapkan langsung;
  - iterasi maksimum untuk konvergensi;
  - tampilan Unrotated Factor Solution dan Scree Plot.
- **Rotation**: None, Varimax, Direct Oblimin (dengan delta), Quartimax, Equimax, dan Promax (dengan kappa). Tersedia tampilan Rotated Solution dan Loading Plots.
- **Scores**: Save as variables dengan metode Regression, Bartlett, atau Anderson-Rubin. Skor disimpan sebagai `FAC1_1`, `FAC2_1`, dan seterusnya. Tersedia juga Display factor score coefficient matrix.
- **Options**: nilai hilang (listwise, pairwise, atau diganti rata-rata) dan penyembunyian koefisien di bawah nilai mutlak tertentu.
- **Log analisis**: setiap eksekusi mencatat sintaks bergaya SPSS (`services/factor-log-generator.ts`).

### Keluaran

Tabel mengikuti format SPSS:

- Descriptive Statistics, Correlation atau Covariance Matrix, beserta inversnya.
- KMO and Bartlett's Test dan Anti-image Matrices.
- Communalities, Total Variance Explained, dan Scree Plot.
- Component Matrix atau Factor Matrix, serta Goodness-of-fit Test untuk Maximum Likelihood dan Generalized Least Squares.
- Reproduced Correlations atau Reproduced Covariances.
- Rotated Component/Factor Matrix (rotasi ortogonal), atau Pattern Matrix, Structure Matrix, dan Component/Factor Correlation Matrix (rotasi oblique).
- Component/Factor Transformation Matrix, Component/Factor Score Coefficient Matrix, dan Loading Plot.

### Alur kerja

```
dialogs/factor-main.tsx                   Mengumpulkan variabel dan opsi
        |
services/factor-analysis.ts               Menyiapkan data dan menjalankan worker
        |
public/workers/FactorAnalysis/factorAnalysis.worker.js
        |                                 Memuat WASM dari ./pkg
rust/ (crate wasm)                        Matriks korelasi, KMO, ekstraksi, rotasi, skor faktor
        |
services/factor-analysis-formatter.ts     Menyusun tabel gaya SPSS
services/factor-analysis-output.ts        Menyimpan hasil dan variabel skor faktor
        |
IndexedDB -> halaman Result
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/dimension-reduction/factor/`

```
factor/
├── charts/                           # FactorLoadingChart.tsx, ScreePlot.tsx
├── constants/                        # factor-default.ts, factor-method.ts
├── dialogs/
│   ├── factor-main.tsx               # Container dialog
│   ├── dialog.tsx
│   └── tabs/                         # Variables, Descriptives, Extraction, Rotation, Scores, Options
├── hooks/                            # tourConfig.ts, useTourGuide.ts
├── services/
│   ├── factor-analysis.ts            # Menjalankan worker
│   ├── factor-analysis-formatter.ts  # Tabel gaya SPSS
│   ├── factor-analysis-output.ts     # Menyimpan hasil dan skor faktor
│   ├── factor-log-generator.ts       # Sintaks bergaya SPSS
│   └── __tests__/
├── types/
└── rust/
    ├── BUILD_INSTRUCTIONS.md
    └── src/
        ├── stats/                    # core, prepare_data, matrix, kmo_test, factor_extraction,
        │                             # extraction_rules, rotation, report, generate_plots
        ├── models/, utils/, wasm/
        └── test/                     # promax_test.rs
```

Berkas pendukung di luar folder modul: `frontend/public/workers/FactorAnalysis/` (worker dan paket WASM), `dimension-reduction/DimensionReductionRegistry.tsx` dan `dimension-reduction-menu.tsx` (registrasi dan menu), serta `frontend/app/help/components/statistics-guide/factor-analysis/` (panduan Help).

### Build ulang WASM

```bash
cd frontend/components/Modals/Analyze/dimension-reduction/factor/rust
cargo test
wasm-pack build --target web     # menulis ke rust/pkg
```

Setelah itu salin `wasm.js`, `wasm_bg.wasm`, `wasm.d.ts`, dan `wasm_bg.wasm.d.ts` dari `rust/pkg` ke `frontend/public/workers/FactorAnalysis/pkg/`. Worker hanya membaca salinan ini.

### Pengujian

- **Unit test Rust** (`cargo test` di folder `rust/`): 6 test lulus, termasuk uji rotasi Promax.
- **Jest** untuk formatter dan penyimpanan hasil, dijalankan dari folder `frontend/`:

  ```bash
  npx jest --runInBand dimension-reduction/factor
  ```

### Dokumentasi

- Catatan teknis di folder modul, antara lain `BUILD_AND_TEST_GUIDE.md`, `IMPLEMENTATION_SUMMARY.md`, `PCA_IMPLEMENTATION_SUMMARY.md`, `WEB_WORKERS_REFACTORING.md`, dan `rust/BUILD_INSTRUCTIONS.md`.
- Panduan di dalam aplikasi: halaman **Help**, bagian Factor Analysis.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Analisis Time Series Lanjutan

**Nama**             : Esra Yosefa Simarmata  
**NIM**              : 222212585  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK MODUL ANALISIS TIME SERIES LANJUTAN  
**Dosen Pembimbing** : Ibnu Santoso, S.S.T., M.T.  

### Deskripsi singkat

Modul ini melanjutkan menu Time Series yang dikembangkan angkatan sebelumnya (Smoothing, Decomposition, Autocorrelation, Unit Root Test, dan Box-Jenkins). Ada empat analisis baru:

- *Autoregressive Distributed Lag* (ARDL);
- *Error Correction Model* (ECM);
- uji homoskedastisitas ARCH-LM;
- model heteroskedastisitas keluarga ARCH/GARCH.

Ketiga model (ARDL, ECM, ARCH/GARCH) juga dilengkapi pembagian data training/testing dan peramalan *out-of-sample*. Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker.

### Cara mengakses

Menu **Analyze > Time Series**:

| Menu | Tab |
|---|---|
| Autoregressive Distributed Lag... | Variables, Options, Time, Split Data, Save |
| Error Correction Model... | Variables, Options, Time, Split Data |
| Homoscedasticity Test (ARCH-LM)... | Variables, Options |
| Heteroskedasticity Models (ARCH/GARCH)... | Variables, Options, Time, Split Data, Forecast |

### Fitur

- **ARDL**:
  - orde lag ditetapkan manual (p untuk Y dan q untuk setiap X), atau dipilih otomatis sampai batas p dan q maksimum;
  - kriteria pemilihan model: AIC (bawaan, sama dengan EViews), Schwarz (BIC/SC), atau Hannan-Quinn;
  - keluaran mencakup koefisien jangka panjang, *bounds test*, dan bentuk ARDL-ECM jangka pendek.
- **ECM** (Engle-Granger, tiga langkah):
  1. regresi jangka panjang;
  2. uji kointegrasi dengan ADF pada residual, dengan lag maksimum yang dapat diatur;
  3. ECM jangka pendek dengan ECT(−1).

  Uji asumsi klasik dijalankan pada residualnya.
- **ARCH-LM**: menguji efek ARCH pada residual dengan jumlah lag q.
- **Model heteroskedastisitas**:
  - jenis model: ARCH(q), GARCH(p, q), EGARCH, TGARCH (GJR), dan IGARCH;
  - estimasi *maximum likelihood* dengan *solver* optimasi;
  - menghasilkan persamaan rata-rata dan varians, serta ragam bersyarat;
  - peramalan ragam beberapa langkah ke depan.
- **Split Data dan peramalan**:
  - data dibagi menjadi training (*in-sample*) dan testing (*out-of-sample*);
  - jendela standar, *rolling window* (ukuran tetap bergeser), atau *expanding window* (sampel makin membesar);
  - akurasi peramalan dievaluasi pada data testing.
- **Interpretasi otomatis** untuk setiap model.

### Keluaran

- **ARDL**:
  - Unrestricted ARDL Equation beserta Fit & Diagnostics;
  - persamaan jangka panjang dan Short Run ARDL-ECM;
  - correlogram residual, plot residual, serta Actual vs Fitted.
- **ECM**:
  - Long Run Regression, Cointegration Test (ADF on Residuals), dan Short Run ECM;
  - Classical Assumptions Tests;
  - correlogram residual ECM dan Equilibrium Error.
- **ARCH-LM**: ARCH-LM Test.
- **ARCH/GARCH**: Mean Equation, Variance Equation, Conditional Variance, Multi-Step Conditional Variance Forecast, dan Variance Forecast Evaluation.
- **Split Data**: Time Series Data Split Summary dan Out-of-Sample Forecast Evaluation.
- **Model Interpretation Summary** untuk setiap model.

### Alur kerja

```
<Analisis>/index.tsx, VariablesTab.tsx, OptionTab.tsx    Mengumpulkan variabel dan opsi
Common/TimeSeriesSplitTab.tsx                            Pengaturan split data
        |
<Analisis>/hooks/analyzeHook.tsx                         Validasi, menyusun payload, menyusun tabel
        |
utils/timeseriesWorkerPool.ts -> public/workers/TimeSeries/worker.js
        |                                                Memuat timeseries.js (kelas ARDL, ECM, GARCH)
wasm/src/time_series/ardl, ecm, garch                    Estimasi, uji, dan peramalan
        |
IndexedDB -> halaman Result
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/TimeSeries/`. Bagian yang dikembangkan dalam modul ini:

```
TimeSeries/
├── ARDL/                             # index.tsx, VariablesTab, OptionTab, hooks/, test/
├── ECM/                              # index.tsx, VariablesTab, OptionTab, hooks/, test/
├── HomoscedasticityTest/             # index.tsx, hooks/, test/
├── HeteroskedasticityModels/         # index.tsx, VariablesTab, hooks/, test/
├── Common/                           # TimeSeriesSplitTab.tsx, useTimeSeriesSplit.ts
├── TimeSeriesMenu.tsx                # Entri menu
└── wasm/                             # Crate Rust "timeseries"
    └── src/time_series/
        ├── ardl/                     # ardl, estimation, lag_generation, long_run_coef, bounds_test
        ├── ecm/                      # ecm, long_run_regression, cointegration_test,
        │                             # error_correction, classical_assumptions, ols_helper
        └── garch/                    # garch, egarch, tgarch, igarch, likelihood, optimizer,
                                      # conditional_variance, diagnostics, arch_lm_test
```

Berkas pendukung di luar folder modul: `frontend/utils/timeseriesWorkerPool.ts`, `frontend/public/workers/TimeSeries/` (worker dan paket WASM), serta `frontend/app/help/components/statistics-guide/time-series/` (panduan Help).

### Build ulang WASM

```bash
cd frontend/components/Modals/Analyze/TimeSeries/wasm
cargo test
wasm-pack build --target web     # nama crate "timeseries", jadi berkasnya timeseries*.js/.wasm
```

Setelah itu salin `timeseries.js`, `timeseries_bg.wasm`, `timeseries.d.ts`, `timeseries_bg.wasm.d.ts`, dan `package.json` dari `wasm/pkg` ke `frontend/public/workers/TimeSeries/`. Ubah juga query `?v=` pada `WORKER_URL` di `utils/timeseriesWorkerPool.ts` supaya browser tidak memakai versi lama dari cache.

### Pengujian

- **Jest** dari folder `frontend/`: 5 suite dan 46 test untuk ARDL, ECM, heteroskedastisitas, homoskedastisitas, dan split data. Semuanya lulus.

  ```bash
  npx jest --runInBand TimeSeries/ARDL TimeSeries/ECM TimeSeries/Heteroskedasticity TimeSeries/Homoscedasticity TimeSeries/Common
  ```

- **Unit test Rust** (`cargo test` di folder `wasm/`): 4 test optimizer GARCH, semuanya lulus.

### Dokumentasi

- Gambaran umum modul Time Series: [TimeSeries/README.md](frontend/components/Modals/Analyze/TimeSeries/README.md).
- Panduan di dalam aplikasi: halaman **Help**, bagian Time Series (ARDL, ECM, Homoscedasticity Test, dan Heteroscedasticity).
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Regresi Ordinal

**Nama**             : Sofia Nur Afifah Rahayu  
**NIM**              : 222212887  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK (MODUL ANALISIS REGRESI ORDINAL)  
**Dosen Pembimbing** : Farid Ridho, S.S.T., M.T.  

### Deskripsi singkat

Modul ini menyediakan regresi ordinal untuk variabel respon berperingkat (minimal tiga kategori). Modelnya adalah *cumulative link model* PLUM, sama dengan prosedur PLUM pada SPSS. Parameter diestimasi dengan Newton-Raphson/Fisher scoring yang dilengkapi *step-halving*. Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker, jadi data tidak dikirim ke server.

### Cara mengakses

Menu **Analyze > Regression > Ordinal...** membuka dialog dengan tab berikut:

| Tab | Fungsi |
|---|---|
| Variables | Memilih variabel dependen, Factor(s), Covariate(s), dan fungsi link |
| Location | Model efek utama atau model dengan suku interaksi |
| Options | Fungsi link, kriteria konvergensi, iterasi maksimum, step-halving, dan selang kepercayaan |
| Output | Tabel yang ditampilkan dan variabel yang disimpan ke dataset |

Tab Scale sudah disiapkan untuk model skala (heteroskedastisitas), tetapi belum diaktifkan.

### Fitur

- **Fungsi link**: Logit (bawaan), Probit, Complementary Log-Log, Negative Log-Log, dan Cauchit.
- **Factor** dikodekan sebagai variabel *dummy* dengan kategori tertinggi sebagai referensi, sama seperti SPSS.
- **Location**: model efek utama atau model dengan interaksi antarvariabel.
- **Options**:
  - toleransi konvergensi parameter, log-likelihood, dan singularitas;
  - iterasi maksimum (bawaan 100) dan step-halving maksimum (bawaan 5);
  - selang kepercayaan (bawaan 95%).
- **Output**:
  - Goodness-of-Fit, Summary Statistics, dan Parameter Estimates;
  - Test of Parallel Lines;
  - matriks kovarians dan korelasi asimtotik;
  - Cell Information dan Iteration History.
- **Save**: Predicted Response Category (`PRE_1`), Estimated Response Probabilities (`EST1_1`, …), Predicted Category Probability (`PCP_1`), dan Actual Category Probability (`ACP_1`).
- **Diagnostik multikolinearitas**: VIF dan GVIF.
- **Log analisis**: setiap eksekusi mencatat sintaks bergaya SPSS (`services/syntaxGenerator.ts`).

### Keluaran

Tabel mengikuti format SPSS PLUM:

- Case Processing Summary dan Model Fitting Information.
- Goodness-of-Fit (Pearson dan Deviance) dan Pseudo R-Square (Cox and Snell, Nagelkerke, McFadden).
- Parameter Estimates (Threshold dan Location).
- Test of Parallel Lines.
- Asymptotic Covariance/Correlation Matrix, Cell Information, dan Iteration History.

### Alur kerja

```
dialogs/OrdinalMain.tsx                   Validasi input dan listwise deletion
        |
services/plum_design_matrix.ts            Dummy coding, interaksi, pemetaan baris
        |
public/workers/Regression/ordinal.worker.js
        |
rust/ (crate statify_ordinal)             Agregasi subpopulasi, Newton-Raphson dengan step-halving,
        |                                 kovarians, Wald, uji garis paralel, goodness-of-fit, VIF/GVIF
services/formatter*.ts                    Menyusun tabel gaya SPSS dan variabel yang disimpan
        |
IndexedDB -> halaman Result
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Regression/Ordinal/`

```
Ordinal/
├── Regresi_Ordinal_Statify.md        # Dokumentasi lengkap modul
├── dialogs/                          # OrdinalMain, VariablesTab, LocationTab, OptionsTab,
│                                     # OutputTab, ScaleTab
├── hooks/tourConfig.ts
├── stores/useOrdinalFormStore.ts     # State dialog yang persisten
├── services/
│   ├── plum_design_matrix.ts         # Design matrix dan dummy coding
│   ├── formatter*.ts                 # Model summary, parameter, parallel lines, matrix,
│   │                                 # iteration history, saved variables, payload
│   ├── syntaxGenerator.ts            # Sintaks bergaya SPSS
│   └── __tests__/
├── types/ordinal.ts
├── UnitTest/                         # Test dialog, store, formatter, dan payload worker
└── rust/
    ├── src/                          # data/, io/, model/, optimizer/, stats/, types/, utils/
    └── tests/                        # plum_*, optimizer_test, gvif_diagnostics,
                                      # computational_whitebox_tests
```

Berkas pendukung di luar folder modul: `frontend/public/workers/Regression/ordinal.worker.js`, `frontend/public/workers/Regression/Ordinal/pkg/` (paket WASM), dan `frontend/app/help/components/statistics-guide/ordinal-regression/` (panduan Help).

### Build ulang WASM

```bash
cd frontend/components/Modals/Analyze/Regression/Ordinal/rust
cargo test --release
wasm-pack build --target web --out-dir pkg --release
```

Setelah itu salin `statify_ordinal_bg.wasm` dan `statify_ordinal.js` dari `rust/pkg` ke `frontend/public/workers/Regression/Ordinal/pkg/`.

### Pengujian

- **Unit test Rust** (`cargo test` di folder `rust/`): 42 test, semuanya lulus. Test ini mencakup lima fungsi link, model lokasi, peluang kategori, optimizer, diagnostik GVIF, dan *white-box* komputasi.
- **Jest** dari folder `frontend/`:

  ```bash
  npx jest --runInBand Regression/Ordinal
  ```

### Dokumentasi

- Dokumentasi lengkap (konsep, panduan antarmuka, arsitektur, rumus, interpretasi, pesan galat, dan panduan pengembang): [Regresi_Ordinal_Statify.md](frontend/components/Modals/Analyze/Regression/Ordinal/Regresi_Ordinal_Statify.md).
- Panduan di dalam aplikasi: halaman **Help**, bagian Ordinal Regression.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Nearest Neighbor

**Nama**             : Louista Thania Harahap  
**NIM**              : 222212707  
**Judul Skripsi**    : PENGEMBANGAN STATIFY: APLIKASI ANALISIS STATISTIK MODUL NEAREST NEIGHBOR  
**Dosen Pembimbing** : Ibnu Santoso, S.S.T., M.T.  

### Deskripsi singkat

Modul ini menyediakan analisis *k-nearest neighbor* (KNN), mengikuti prosedur KNN pada SPSS. Untuk target kategorik, analisis ini mengklasifikasikan kasus. Untuk target skala, analisis ini memprediksi nilai. Modul ini juga dapat memilih k dan fitur secara otomatis. Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker.

### Cara mengakses

Menu **Analyze > Classify > Nearest Neighbor...** membuka dialog dengan tab berikut:

| Tab | Fungsi |
|---|---|
| Variables | Target, Features, Focal Case Identifier (opsional), dan normalisasi fitur skala |
| Neighbors | Jumlah tetangga k dan ukuran jarak |
| Features | Seleksi fitur |
| Partition | Pembagian training/holdout dan validasi silang |
| Save | Variabel hasil yang disimpan ke dataset |
| Output | Tabel dan grafik yang ditampilkan |

Setiap pengaturan dilengkapi ikon bantuan yang menjelaskan fungsinya.

### Fitur

- **Neighbors**:
  - k tetap, atau dipilih otomatis dalam rentang minimum sampai maksimum;
  - jarak Euclidean atau Manhattan (City-block);
  - pembobotan fitur menurut tingkat kepentingannya;
  - prediksi target skala memakai rata-rata atau median tetangga.
- **Features**: *forward selection* dengan fitur yang dipaksa masuk. Kriteria berhentinya berupa jumlah fitur yang dipilih atau perubahan minimum.
- **Partition**:
  - persentase training/holdout yang diacak, atau ditentukan dari variabel partisi;
  - validasi silang *V-fold* (jumlah fold acak atau dari variabel);
  - seed Mersenne Twister supaya hasil dapat diulang.
- **Save**: nilai atau kategori prediksi, probabilitas prediksi per kategori, variabel partisi, dan variabel fold. Nama variabel dapat dibuat otomatis atau ditentukan sendiri.
- **Output**: Case Processing Summary, tabel tetangga dan jarak, *peers chart*, dan *quadrant map*.
- **Ekspor**: tabel dapat diunduh sebagai CSV atau Excel, dan grafik sebagai gambar.

### Keluaran

- System Settings dan Case Processing Summary.
- Predictor Space (grafik ruang prediktor) dan grafik pemilihan k.
- Feature Importance.
- Classification Table untuk target kategorik dan Error Summary.
- Neighbor Details (tetangga dan jarak untuk kasus fokus), Peers Chart, dan Quadrant Map.
- Interpretasi otomatis (`services/nearest-neighbor-analysis-interpretation.ts`).

### Alur kerja

```
dialogs/nearest-neighbor-main.tsx         Mengumpulkan variabel dan opsi, validasi (hooks/use*Rules.ts)
        |
services/nearest-neighbor-analysis.ts     Menyiapkan data dan menjalankan worker
        |
public/workers/Classify/NearestNeighbor/nearest-neighbor.worker.js
        |
rust/ (crate wasm)                        Normalisasi, partisi, jarak, pemilihan k dan fitur,
        |                                 prediksi, kepentingan prediktor
services/nearest-neighbor-analysis-formatter.ts
        |                                 Tabel dan grafik
IndexedDB -> halaman Result
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Classify/nearest-neighbor/`

```
nearest-neighbor/
├── components/                       # Grafik: Predictor Space, Peers, pemilihan k; menu unduh
├── constants/                        # Nilai bawaan dan daftar keluaran
├── dialogs/                          # nearest-neighbor-main, dialog (Variables), neighbors,
│                                     # features, partition, save, output, field-help
├── hooks/                            # Aturan validasi untuk partition, save, output
├── services/                         # analysis, formatter, interpretation, output,
│                                     # error-messages, performance
├── utils/output-export.ts            # Ekspor tabel (CSV/Excel) dan grafik (gambar)
├── types/
├── __tests__/                        # Unit, basis path, performa, ekspor
└── rust/src/
    ├── stats/                        # nearest_neighbor, distance, normalization, partition,
    │                                 # k_selection, feature_selection, prediction,
    │                                 # predictor_importance, predictor_space, mersenne_twister, ...
    └── models/, utils/, wasm/
```

Berkas pendukung di luar folder modul: `frontend/public/workers/Classify/NearestNeighbor/` (worker dan paket WASM) dan `Classify/ClassifyRegistry.tsx` (registrasi dialog).

### Build ulang WASM

```bash
cd frontend/components/Modals/Analyze/Classify/nearest-neighbor/rust
cargo test
wasm-pack build --target web     # menulis ke rust/pkg
```

Setelah itu salin `wasm.js`, `wasm_bg.wasm`, `wasm.d.ts`, dan `wasm_bg.wasm.d.ts` dari `rust/pkg` ke `frontend/public/workers/Classify/NearestNeighbor/pkg/`. Ubah juga nilai `?v=` di `nearest-neighbor.worker.js` supaya browser memuat versi baru.

### Pengujian

- **Jest** dari folder `frontend/`, mencakup unit, *basis path*, aturan validasi, grafik, dan ekspor keluaran: 12 suite dan 252 test, semuanya lulus. Suite performa (`*.performance.test.ts`) membutuhkan waktu lama, jadi sebaiknya dijalankan terpisah.

  ```bash
  npx jest --runInBand Classify/nearest-neighbor --testPathIgnorePatterns performance
  npx jest --runInBand nearest-neighbor.performance     # uji performa
  ```

- **Unit test Rust** (`cargo test` di folder `rust/`): 74 test, semuanya lulus.

### Dokumentasi

- Bantuan di dalam dialog: ikon bantuan pada setiap pengaturan (`dialogs/field-help.tsx`).
- Panduan penggunaan modul: _(tautan menyusul)_

---

## K-Medoids

**Nama**             : Bela Novita Sari  
**NIM**              : 222212534  
**Judul Skripsi**    : PENGEMBANGAN MODUL K-MEDOIDS PADA APLIKASI STATIFY  
**Dosen Pembimbing** : Dr. Achmad Syahrul Choir, S.S.T., M.Si.  

### Deskripsi singkat

Modul ini menyediakan analisis klaster K-Medoids dengan tiga algoritma:

- **PAM**: kualitas terbaik, untuk data kecil sampai menengah;
- **CLARA**: memakai sampling, untuk data besar;
- **CLARANS**: pencarian acak, seimbang antara kecepatan dan kualitas.

Jumlah klaster dapat dipilih otomatis dengan silhouette atau metode elbow. Perhitungan berjalan dengan Rust/WebAssembly di dalam Web Worker, dan hasilnya ditampilkan dalam tabel serta berbagai grafik.

### Cara mengakses

Menu **Analyze > Clustering > K-Medoids Cluster...** membuka dialog dengan tab berikut:

| Tab | Fungsi |
|---|---|
| Variables | Variabel klaster, jumlah klaster k (tetap atau rentang), dan ukuran jarak |
| Iterate | Algoritma beserta parameter iterasinya |
| Results | Tabel hasil inti dan informasi tambahan |
| Evaluation | Silhouette dan pemilihan k optimal |
| Save | Variabel hasil yang disimpan ke dataset |
| Options | Visualisasi, matriks jarak, dan praproses |

Bila datanya terlalu besar untuk PAM, dialog menampilkan peringatan dan menyarankan CLARA.

### Fitur

- **Jarak**: Euclidean atau Manhattan (City-block).
- **Iterate**:
  - iterasi maksimum dan toleransi konvergensi;
  - seed default, acak, atau ditentukan sendiri, serta jumlah inisialisasi;
  - parameter CLARA: ukuran dan jumlah sampel;
  - parameter CLARANS: jumlah *local minima* dan tetangga maksimum.
- **Results**: algoritma konvergensi, riwayat iterasi, keanggotaan klaster, jumlah kasus per klaster, medoid tiap klaster, grafik konvergensi, dan riwayat sampling CLARA.
- **Evaluation**: plot silhouette per objek, penilaian kualitas keseluruhan, serta grafik dan tabel k optimal (silhouette dan elbow).
- **Save**: keanggotaan klaster dan jarak ke pusat klaster.
- **Options**:
  - normalisasi: tanpa normalisasi, Z-score, atau Min-Max;
  - nilai hilang: listwise, median, atau imputasi KNN;
  - proyeksi PCA, *scatter plot* klaster, dan distribusi ukuran klaster;
  - matriks jarak antar-medoid, dalam bentuk grafik dan tabel.

### Keluaran

- Kartu ringkasan, tabel medoid, keanggotaan, dan jumlah kasus per klaster.
- Riwayat iterasi beserta grafik konvergensi.
- Silhouette per objek dan per k, grafik elbow, serta tabel k optimal.
- *Scatter plot* klaster, proyeksi PCA, distribusi ukuran klaster, dan matriks jarak.

### Alur kerja

```
dialogs/k-medoids-cluster-main.tsx        Mengumpulkan variabel dan opsi (services/*-guards.ts memvalidasi)
        |
services/k-medoids-cluster-analysis.ts    Menjalankan Web Worker (services/cluster-worker.ts)
        |
public/workers/Clustering/K-Medoids/wasm*  Paket WASM: PAM, CLARA, CLARANS, jarak, silhouette
        |
services/k-medoids-cluster-comprehensive-output.ts
        |                                 Menyusun tabel dan grafik (components/OutputRenderer.tsx)
IndexedDB -> halaman Result               Variabel Save ditulis lewat services/k-medoids-cluster-save.ts
```

### Struktur direktori

Lokasi kode: `frontend/components/Modals/Analyze/Clustering/k-medoids-cluster/`

```
k-medoids-cluster/
├── README.md                         # Dokumentasi algoritma dan build
├── components/                       # OutputRenderer, SummaryCards, ElbowChart, SilhouetteKChart,
│                                     # SilhouettePerObjectChart, ClusterScatterPlot, PCAClusterPlot,
│                                     # ConvergenceChart, DistanceMatrix, IterationDetailsTable, ...
├── constants/k-medoids-cluster-default.ts
├── dialogs/                          # k-medoids-cluster-main, dialog (Variables), iterate,
│                                     # results, evaluation, save, options
├── services/                         # analysis, cluster-worker, comprehensive-output, guards, save
├── formula-tests/                    # Uji rumus euclidean, manhattan, min_max
├── __tests__/                        # ut-pre-* (praproses) dan ut-out-* (keluaran)
└── rust/
    ├── build.bat
    └── src/
        ├── algorithms/               # pam.rs, clara.rs, clarans.rs
        ├── stats/                    # normalization, preprocessing
        ├── utils/                    # distance, validation
        ├── models/, wasm/
        └── test/
```

Berkas pendukung di luar folder modul: `frontend/public/workers/Clustering/` (worker dan paket WASM), `Clustering/clustering-menu.tsx` dan `ClusteringRegistry.tsx` (menu dan registrasi), serta `frontend/app/help/components/statistics-guide/k-medoids/` (panduan Help).

### Build ulang WASM

```bash
cd frontend/components/Modals/Analyze/Clustering/k-medoids-cluster/rust
cargo test
wasm-pack build --target web --out-dir pkg
```

Setelah itu salin `wasm.js`, `wasm_bg.wasm`, `wasm.d.ts`, `wasm_bg.wasm.d.ts`, dan `package.json` dari `rust/pkg` ke `frontend/public/workers/Clustering/K-Medoids/`.

### Pengujian

- **Jest** dari folder `frontend/`: 24 suite dan 42 test untuk praproses dan keluaran. Semuanya lulus.

  ```bash
  npx jest --runInBand Clustering/k-medoids-cluster
  ```

- **Unit test Rust** (`cargo test` di folder `rust/`): menurut README modul ada 33 test. Uji rumus jarak dan normalisasi ada di `formula-tests/`.

### Dokumentasi

- Dokumentasi algoritma, jarak, pemilihan k, kinerja, dan build: [README K-Medoids](frontend/components/Modals/Analyze/Clustering/k-medoids-cluster/README.md) dan [README paket WASM](frontend/public/workers/Clustering/K-Medoids/README.md).
- Panduan di dalam aplikasi: halaman **Help**, bagian K-Medoids.
- Panduan penggunaan modul: _(tautan menyusul)_

---

## Text Analytics

**Nama**             : Yedija Lewi Suryadi  
**NIM**              : 222212921  
**Judul Skripsi**    : PENGEMBANGAN MODUL TEXT ANALYTICS PADA APLIKASI STATISTIK STATIFY: FITUR TEXT PREPROCESSING DAN KLASIFIKASI NAIVE BAYES  
**Dosen Pembimbing** : Dr. Eng. Lya Hulliyyatus Suadaa, S.S.T., M.T.  

### Deskripsi singkat

Modul ini menambahkan analisis teks ke Statify melalui tiga menu. Ketiganya memakai satu crate Rust bersama, `statify-text-core` (CORE), sehingga praproses teksnya identik di semua menu:

- **String to Word Vector**: mengubah satu kolom teks menjadi kolom-kolom angka (*bag-of-words*, TF-IDF).
- **Naive Bayes**: melatih dan mengevaluasi model klasifikasi dengan prediktor numerik, kategorik, dan teks.
- **Apply Model**: menerapkan model Naive Bayes yang sudah diekspor ke data baru.

Seluruh perhitungan berjalan dengan Rust/WebAssembly di browser.

### Cara mengakses

| Menu | Tab |
|---|---|
| **Transform > String to Word Vector** | Variables, Options |
| **Analyze > Classify > Naive Bayes** | Variables, Text Preprocessing, Options, Validation, Output |
| **Analyze > Classify > Apply Model** | Model, Variables, Save, Output |

Ketiga menu terbuka sebagai panel di sisi kanan.

### Fitur

- **Praproses teks** (String to Word Vector dan tab Text Preprocessing pada Naive Bayes):
  - lowercase dan penghapusan stopword (Indonesia, Inggris, atau daftar sendiri);
  - stemming Indonesia (Sastrawi, Nazief–Adriani) atau Inggris (Porter2);
  - tokenizer kata atau n-gram 1–5, dengan delimiter yang dapat diatur;
  - standar rumus Weka, scikit-learn, atau Custom, dengan pilihan TF, IDF, dan normalisasi;
  - batas jumlah kata (*Words to Keep*) dan frekuensi minimum.
- **Naive Bayes**:
  - prediktor numerik: Gaussian, atau Gaussian dengan batas simpangan baku minimum ala Weka;
  - prediktor kategorik: Laplace smoothing;
  - fitur teks: Multinomial, Bernoulli, atau Complement Naive Bayes;
  - sumber fitur teks: kolom teks mentah (*Raw Text*), yang kosakatanya di-fit ulang per split sehingga tidak bocor, atau kolom vektor kata hasil String to Word Vector;
  - validasi holdout atau *k-fold cross-validation*, keduanya terstratifikasi, dengan seed Mersenne Twister;
  - tabel kata paling berpengaruh per kelas;
  - **Export Model** ke JSON.
- **Apply Model**:
  - sumber model: unggah berkas JSON atau ambil dari Output Viewer;
  - pemetaan variabel otomatis berdasarkan nama;
  - teks baru diproses dengan resep yang sama dengan saat pelatihan;
  - prediksi dan probabilitas ditulis sebagai variabel baru;
  - metrik evaluasi bila kelas sebenarnya tersedia.

### Keluaran

- **String to Word Vector**: kolom baru `VEC_<kata>` di dataset, beserta ringkasan kosakata di Output Viewer.
- **Naive Bayes**:
  - Case Processing Summary dan Attribute Distribution Table;
  - Model Evaluation Metrics dan Confusion Matrix;
  - Text Feature Table (Top-k kata per kelas);
  - berkas model yang dapat diekspor.
- **Apply Model**: ringkasan model dan penerapan, kolom prediksi dan probabilitas di dataset, serta metrik evaluasi dan confusion matrix bila target sebenarnya dipilih.

### Alur kerja

```
StringToWordVectorModal.tsx  /  naive-bayes-main.tsx  /  apply-model-main.tsx
        |
Worker: stringToWord.processor.ts  /  public/workers/Classify/NaiveBayes/naive-bayes.worker.js
        |                              /  public/workers/Classify/ApplyModel/apply-model.worker.js
Crate WASM per menu (StringToWordVector/rust, naive-bayes/rust, apply-model/rust)
        |
public/workers/TextAnalytics/statify-text-core     Praproses dan vektorisasi bersama (CORE)
        |
Formatter -> dataset (kolom baru) dan Output Viewer
```

### Struktur direktori

```
frontend/components/Modals/Transform/StringToWordVector/
├── DOKUMENTASI.md                    # Panduan, teori, dan dokumentasi teknis
├── StringToWordVectorModal.tsx, VariablesTab.tsx, OptionsTab.tsx, config.ts
├── hooks/, utils/, constants/        # stopwords, opsi vektorisasi
├── stringToWord.processor.ts         # Worker
└── rust/                             # Crate WASM tipis di atas CORE

frontend/components/Modals/Analyze/Classify/naive-bayes/
├── DOKUMENTASI.md
├── dialogs/                          # naive-bayes-main, text-preprocessing, options, validation, output
├── components/, hooks/, constants/
└── rust/                             # Crate WASM Naive Bayes

frontend/components/Modals/Analyze/Classify/apply-model/
├── DOKUMENTASI.md
├── dialogs/                          # apply-model-main, model-tab, variables-tab, save-tab, output-tab
├── adapters/                         # Registry multi-algoritma (saat ini Naive Bayes)
├── services/, hooks/, constants/
└── rust/                             # Crate WASM Apply Model

frontend/public/workers/TextAnalytics/statify-text-core/    # CORE: validator, pipeline, vectorizer
frontend/public/workers/Classify/NaiveBayes/, ApplyModel/   # Worker dan paket WASM
```

### Build ulang WASM

- **String to Word Vector**: jalankan `wasm-pack build --target web --out-dir ../wasm-output --release` dari folder `StringToWordVector/rust`. Hasilnya diimpor langsung oleh worker.
- **Naive Bayes** dan **Apply Model**: jalankan `wasm-pack build --target web --release` dari folder `rust/` masing-masing. Setelah itu salin `wasm.js`, `wasm_bg.wasm`, `wasm.d.ts`, dan `wasm_bg.wasm.d.ts` ke `frontend/public/workers/Classify/NaiveBayes/pkg/` atau `.../ApplyModel/pkg/`. Naikkan juga konstanta versi WASM di service dan query `?v=` di worker.

Langkah lengkapnya ada di bagian C pada setiap `DOKUMENTASI.md`.

### Pengujian

- **Jest** dari folder `frontend/` untuk ketiga menu: 1.247 test lulus dari 77 suite.

  ```bash
  npx jest --runInBand components/Modals/Analyze/Classify/naive-bayes components/Modals/Analyze/Classify/apply-model components/Modals/Transform/StringToWordVector --coverage=false
  ```

  Lima suite evaluasi integrasi (`__tests__/eval/integration.*`) membaca dataset di luar repo, misalnya `Claude outputs/pilkada_train.csv`. Suite ini hanya dapat dijalankan bila dataset tersebut tersedia.
- **Unit test Rust** (`cargo test`), menurut catatan di `DOKUMENTASI.md`:
  - CORE: 91 test;
  - Naive Bayes: 203 test;
  - Apply Model: 156 test.

### Dokumentasi

- [String to Word Vector](frontend/components/Modals/Transform/StringToWordVector/DOKUMENTASI.md), [Naive Bayes](frontend/components/Modals/Analyze/Classify/naive-bayes/DOKUMENTASI.md), dan [Apply Model](frontend/components/Modals/Analyze/Classify/apply-model/DOKUMENTASI.md). Setiap dokumen memuat panduan pengguna, landasan teori dan rumus, serta dokumentasi teknis.
- CORE: [README](frontend/public/workers/TextAnalytics/statify-text-core/README.md).
- Panduan di dalam aplikasi: halaman **Help**, bagian Text Analytics.
- Panduan penggunaan modul: _(tautan menyusul)_
