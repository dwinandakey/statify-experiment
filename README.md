# Statify

**Statify** adalah aplikasi analisis statistik berbasis web yang berfungsi untuk mendukung proses pembelajaran mata kuliah di bidang statistik di lingkungan **Politeknik Statistika STIS**. **Statify** memudahkan pengguna untuk mengunggah data dan melakukan analisis statistik. Dibangun dengan Next.js untuk frontend dan Express.js untuk backend, dengan penyimpanan data menggunakan IndexedDB di browser.

## Riwayat Pengembangan

| Angkatan | Cakupan | Dokumentasi |
|---|---|---|
| 63 | Enam modul yang dikembangkan paralel | [README_Statify_63.md](README_Statify_63.md) |
| 64 | Sebelas modul yang dikembangkan paralel | [README_Statify_64.md](README_Statify_64.md) |

## Fitur

### Manajemen data

- **Impor**: file SPSS (`.sav`), CSV, Excel (`.xlsx`), clipboard, dan contoh dataset.
- **Ekspor**: CSV dan Excel, serta cetak (Print).
- **Data**: Aggregate, Sort Cases/Variables, Select Cases, Weight Cases, Transpose, Restructure, Duplicate Cases, Unusual Cases, Define Variable Properties, Set Measurement Level, Define Date/Time.
- **Transform**: Compute Variable, Rank Cases, Recode (into same/different variables), String to Word Vector.
- **Edit**: Find and Replace, Go To.
- **Penyimpanan otomatis** ke IndexedDB di browser (Dexie), sehingga data dan hasil analisis tetap ada setelah halaman dimuat ulang.

### Analisis statistik

Modul berikut ada di `frontend/components/Modals/Analyze/`. Sebagian item di menu masih berstatus nonaktif.

| Kelompok | Isi |
|---|---|
| Descriptive Statistics | Descriptives, Frequencies, Explore, Crosstabs |
| Compare Means | One-Sample T Test, Independent-Samples T Test, Paired-Samples T Test, One-Way ANOVA, Bartlett Test |
| Correlate | Bivariate |
| Regression | Linear, Binary Logistic, Multinomial Logistic, Ordinal, Curve Estimation |
| General Linear Model | Univariate, Multivariate, Repeated Measures, Variance Components |
| Nonparametric Tests | Legacy Dialogs |
| Classify | Naive Bayes, Nearest Neighbor, Discriminant, Decision Tree, ROC Analysis/Curve, K-Means, K-Medoids, Hierarchical, Two-Step Cluster, Apply Model |
| Dimension Reduction | Factor, Correspondence Analysis, Optimal Scaling |
| Time Series | Smoothing, Decomposition, Autocorrelation, Unit Root Test, Box-Jenkins, ARDL, ECM, Heteroskedasticity Models, Homoscedasticity Test |
|| Text Analytics | String to Word Vector (menu Transform) dan analisis teks (worker `TextAnalytics`) |
### Visualisasi

- **Chart Builder** dan **Legacy Dialogs** di menu Graphs, dengan Chart.js, ECharts, D3, dan Recharts.
- **Real-time Updates**: Visualisasi yang berubah sesuai filter data
- **Export Visualisasi**: Simpan chart sebagai PNG, PDF, atau SVG

### Antarmuka

-- Tampilan hasil bergaya SPSS (tabel output, catatan kaki, interpretasi singkat) dan log analisis.
- Halaman **Help** berisi panduan statistik dan penggunaan modul.
- Tur fitur interaktif pada dialog analisis.

### User Experience

- **Progressive Web App**: Dapat di-install sebagai aplikasi desktop
- **Auto-save**: Penyimpanan otomatis ke IndexedDB browser
- **Responsive Design**: Mendukung desktop, tablet, dan mobile
- **Offline Support**: Bekerja tanpa koneksi internet setelah di-load

## Arsitektur

```
Dialog (React)  ->  Web Worker  ->  WASM (Rust)  ->  Formatter (TypeScript)  ->  IndexedDB  ->  Halaman Result
 input variabel     siapkan data    hitung statistik   susun tabel gaya SPSS      simpan log,       tampilkan tabel
 dan opsi           (cleaning,      (IRLS, uji, dll.)                             analytic,         dan grafik
                    pengodean)                                                    statistic
```

- **Frontend (Next.js)** menjalankan seluruh alur di atas di browser. Worker berada di `frontend/public/workers/`, sedangkan sumber Rust berada di folder `rust/` atau `wasm/` pada tiap modul.
- **Backend (Express.js)** hanya melayani file `.sav`:
  - `POST /api/sav/upload`: membaca file `.sav` menjadi data dan metadata variabel.
  - `POST /api/sav/create`: membuat file `.sav` dari data.
  - `GET /api-docs`: dokumentasi Swagger.
- Keamanan backend: Helmet, CORS dengan daftar origin yang diizinkan (`backend/server/config/constants.ts`), batas unggah 10 MB, dan rate limiting (dinonaktifkan secara default).

## Struktur Direktori

```
statify/
├── frontend/                       # Aplikasi web Next.js 15 (React 18, TypeScript)
│   ├── app/                        # App Router: landing, dashboard, help
│   ├── components/
│   │   └── Modals/                 # Seluruh dialog fitur
│   │       ├── Analyze/            # Modul analisis (lihat tabel di atas)
│   │       ├── Data/  Edit/  File/  Graphs/  Transform/
│   │       └── ModalRegistry.tsx   # Pendaftaran dialog -> komponen
│   ├── hooks/  lib/  services/  stores/  repositories/  types/  utils/
│   ├── public/workers/             # Web Worker + paket WASM hasil build
│   └── __tests__/  __mocks__/      # Pengujian dan mock frontend
├── backend/                        # Express.js: pemrosesan file .sav
│   ├── server/
│   │   ├── app.ts  index.ts        # Aplikasi Express dan entry point
│   │   ├── config/  routes/  controllers/  services/  types/
│   │   └── __tests__/
│   └── patches/                    # Patch untuk sav-reader (patch-package)
├├── 1. Panduan Penggunaan/          # Panduan penggunaan Statify (PDF)
── patches/                        # Patch untuk sav-reader di level root
├── docker-compose.yml              # Menjalankan frontend + backend lewat Docker
├── docker-compose.dokploy.yml      # Konfigurasi deployment Dokploy (Traefik)
├── README.md                       # Dokumen ini
├── README_Statify_63.md            # Kontributor dan modul angkatan 63
└── README_Statify_64.md            # Kontributor dan modul angkatan 64
```

Dokumentasi per bagian: [frontend/README.md](frontend/README.md), [backend/Readme.md](backend/Readme.md), [backend/server/README.md](backend/server/README.md), [frontend/components/Modals/README.md](frontend/components/Modals/README.md) (arsitektur modal), [frontend/components/Modals/Analyze/README.md](frontend/components/Modals/Analyze/README.md), dan [frontend/public/workers/README.md](frontend/public/workers/README.md) (pola worker).

## Teknologi

| Bagian | Teknologi |
|---|---|
| Frontend | Next.js 15, React 18, TypeScript, Tailwind CSS, Radix UI, Framer Motion, Lucide |
| State dan data | Zustand, Dexie (IndexedDB), Handsontable (grid data), PapaParse, SheetJS (xlsx) |
| Komputasi | Rust, wasm-bindgen, wasm-pack (WASM di Web Worker), Math.js, jStat |
| Visualisasi | Chart.js, ECharts, D3, Recharts |
| Ekspor | jsPDF, SheetJS |
| Backend | Express.js 4, TypeScript, Zod, Formidable, Helmet, CORS, express-rate-limit, swagger-ui-express, sav-reader, sav-writer |
|| Pengujian | Jest, Testing Library, `cargo test` |
 Deployment | Docker, Docker Compose, Dokploy (Traefik) |

## Prasyarat Sistem

### Development Environment

- **Node.js**: v18.0.0 atau lebih baru
- **npm**: v8.0.0 atau lebih baru
- **Git**: Untuk version control
- **Docker** (opsional): Untuk containerized development

### Production Environment

- **OS**: Linux (Ubuntu 20.04+ direkomendasikan)
- **Memory**: Minimum 2GB RAM
- **Storage**: 10GB free space
- **Network**: Port 80, 443, 3000, 5000 terbuka

## Instalasi dan Setup

### Metode 1: Development Setup

1. **Clone Repository**

   ```bash
   git clone https://github.com/yourusername/statify.git
   cd statify
   ```

2. **Install Dependencies**

   ```bash
   # Install semua dependencies untuk workspaces
   npm run install:all

   # Alternatif: install manual
   npm install
   cd frontend && npm install
   cd ../backend && npm install
   ```

3. **Setup Environment Variables**

   ```bash
   # Copy environment template
   cp .env.example .env
   cp frontend/.env.example frontend/.env.local
   cp backend/.env.example backend/.env

   # Edit file .env sesuai kebutuhan
   nano .env
   ```

4. **Setup Environment Variables**

   ```bash
   # Edit file .env sesuai kebutuhan
   # Pastikan NEXT_PUBLIC_BACKEND_URL sesuai dengan port backend
   ```

5. **Jalankan Aplikasi**

   ```bash
   # Mode development (auto-restart)
   npm run dev

   # Frontend: http://localhost:3000
   # Backend: http://localhost:5000
   # API Docs: http://localhost:5000/api-docs
   ```

### Metode 2: Docker Setup

1. **Build dan Jalankan Container**

   ```bash
   # Build semua services
   docker-compose up -d

   # Verifikasi status
   docker-compose ps
   ```

2. **Akses Aplikasi**
   - **Frontend**: http://localhost:3001
   - **Backend**: http://localhost:5000

3. **Monitoring Container**

   ```bash
   # Logs real-time
   docker-compose logs -f

   # Restart services
   docker-compose restart

   # Stop services
   docker-compose down
   ```

### Metode 3: Production Deployment

1. **Build Production**

   ```bash
   # Build frontend
   cd frontend
   npm run build

   # Build backend
   cd ../backend
   npm run build
   ```

2. **Deploy dengan Docker**

   ```bash
   # Production build
   docker-compose -f docker-compose.prod.yml up -d

   # Dengan reverse proxy (nginx)
   docker-compose -f docker-compose.nginx.yml up -d
   ```

## Cara Penggunaan

### 1. Upload Data

1. Buka http://localhost:3000
2. Klik tombol "Upload Data" di dashboard
3. Pilih file (format: .sav, .csv, .xlsx, .json)
4. Review data preview
5. Klik "Proceed to Analysis"

### 2. Analisis Statistik

1. Pilih jenis analisis dari menu sidebar
2. Pilih variabel yang ingin dianalisis
3. Konfigurasi parameter analisis
4. Klik "Run Analysis"
5. Tunggu hasil (progress bar akan muncul)

### 3. Visualisasi Data

1. Setelah analisis selesai, klik tab "Visualization"
2. Pilih tipe chart yang diinginkan
3. Drag-and-drop variabel ke sumbu X dan Y
4. Customize warna, label, dan style
5. Export chart sebagai gambar

### 4. Export Hasil

1. Klik tombol "Export" di hasil analisis
2. Pilih format (PDF, Excel, PNG)
3. Pilih komponen yang ingin diexport
4. Download file hasil

## Testing

### Unit Testing

```bash
# Frontend tests
cd frontend
npm run test

# Backend tests
cd backend
npm run test
```

### E2E Testing

```bash
# Install Playwright browsers
npx playwright install

# Jalankan E2E tests
npm run test:e2e
```

### Testing Khusus

```bash
# Frontend descriptive statistics tests
npm run test:descriptive --workspace=frontend

# Backend specific tests
npm test --workspace=backend
```

## Development Guide

### Code Style

- Gunakan ESLint untuk code linting
- Follow TypeScript strict mode
- Jest untuk testing
- Gunakan Prettier untuk code formatting

### Branch Strategy

- `main`: Production-ready code
- Gunakan branch baru untuk setiap fitur/bugfix

### Pull Request Guidelines

1. Pastikan semua tests pass
2. Update dokumentasi jika perlu
3. Request review sebelum merge

## Monitoring dan Logging

### Aplikasi Monitoring

- **Frontend**: Browser DevTools dan console logging
- **Backend**: Console logging dengan built-in logging
- **Storage**: Browser IndexedDB monitoring via DevTools Application tab
- **Performance**: Browser DevTools Performance tab untuk profiling

### Health Checks

```bash
# Check backend status
curl http://localhost:5000

# Check frontend build
npm run build
```

## Security

### Best Practices

- Rate limiting untuk API endpoints (express-rate-limit)
- Input validation dan sanitization (Zod schema validation)
- CORS configuration yang ketat
- Environment variables untuk konfigurasi
- Security headers dengan Helmet

### Security Headers

- Content-Security-Policy
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy

## Mengubah Modul Berbasis Rust/WASM

Setiap modul yang menghitung dengan Rust memiliki crate sendiri (`rust/` atau `wasm/` di folder modulnya). Secara umum:

1. Ubah kode Rust, lalu jalankan `cargo test` di folder crate tersebut.
2. Build paket WASM: `wasm-pack build --target web`.
3. Salin berkas hasil build (`*.wasm`, `*.js`, `*.d.ts`, `package.json`) ke folder worker modul di `frontend/public/workers/...`.

Worker hanya membaca salinan di `public/workers`, sehingga langkah 3 tidak boleh terlewat. Contoh langkah lengkap ada di [README_Statify_64.md](README_Statify_64.md).

## Alur Kontribusi

- Setiap kontributor bekerja di branch sendiri (per modul atau per fitur), lalu digabung ke `main` lewat merge request.
- Pesan commit mengikuti pola `jenis(modul): ringkasan`, misalnya `fix(glm-rm): ...`, `feat(glm-mv): ...`, `test(glm): ...`, `docs(...)`.
- Jalankan pengujian modul yang diubah sebelum membuat merge request.

## Troubleshooting

| Masalah | Penanganan |
|---|---|
| Frontend tidak terhubung ke backend | Periksa `NEXT_PUBLIC_BACKEND_URL` dan pastikan backend berjalan di port 5000. Cek juga daftar origin CORS di `backend/server/config/constants.ts`. |
| Upload `.sav` gagal | Pastikan berkas berformat `.sav` dan tidak lebih dari 10 MB. |
| Angka hasil analisis tidak berubah setelah mengubah kode Rust | Paket WASM di `frontend/public/workers/...` belum disalin ulang (lihat bagian Mengubah Modul Berbasis Rust/WASM). |
| Data atau hasil analisis tidak muncul | Bersihkan data situs di browser (IndexedDB) lewat DevTools > Application. |
| Install atau build gagal | Hapus `node_modules` lalu jalankan `npm install` ulang di root. |

## Lisensi

Proyek ini menggunakan **MIT License**. Lihat berkas [LICENSE](LICENSE).
arts, dan D3.js** - Library visualisasi data
- **TypeScript Team** - Type safety yang menjaga kode tetap maintainable
- **Zustand Team** - State management yang sederhana dan efektif
- **Semua kontributor open source** - Terima kasih atas library dan tools yang digunakan

---

**Statify** - Membuat analisis statistik menjadi mudah dan menyenangkan!

_Dibuat dengan komunitas open source_
rts, dan D3.js** - Library visualisasi data
- **Next.js Team** - Untuk framework React yang modern
- **Express.js Community** - Backend framework yang ringan dan powerful
- **Chart.js, ECharts, dan D3.js** - Library visualisasi data
- **TypeScript Team** - Type safety yang menjaga kode tetap maintainable
- **Zustand Team** - State management yang sederhana dan efektif
- **Semua kontributor open source** - Terima kasih atas library dan tools yang digunakan
---