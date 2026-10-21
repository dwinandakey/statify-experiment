//! Pembanding native untuk workload "core" eksperimen v2 (Tugas 7): `irls_core` yang SAMA
//! dengan paket wasm (bench::irls_core::irls_core, dipanggil lewat library crate, tidak disalin),
//! dikompilasi untuk CPU host. Titik pembanding (core, kondisi warm), bukan faktor eksperimen.
//!
//! Satu proses = satu "invocation": baca design matrix dari benchmark-results/<runId>/design/
//! (N<N>.X.f64, N<N>.y.f64: Float64 little-endian; N<N>.json: n, p, featureNames, sha256),
//! verifikasi SHA-256, lalu untuk setiap N (urutan diacak dengan --seed: N diurutkan naik lalu
//! Fisher–Yates mulberry32, sama dengan sizeOrder "shuffled" di browser): warm-up, lalu repetisi.
//! Waktu diukur dengan std::time::Instant HANYA di sekitar pemanggilan irls_core (setara
//! wasmCoreMs di browser: tanpa membaca berkas dan tanpa menyalin input).
//!
//!   irls_native_bench --design-dir <dir> --invocation <k> [--seed <u32>] [--warmup 5]
//!                     [--repetitions 30] [--max-iter 20] [--tol 0.001] [--out <file.csv>]
//!
//! Tanpa dependensi baru (Cargo.lock mengunci paket wasm yang diukur): SHA-256 ditulis di sini,
//! JSON dibaca dengan serde_json yang sudah menjadi dependensi crate.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use statify_logistic::bench::irls_core::irls_core;

struct Args {
    design_dir: PathBuf,
    invocation: u32,
    seed: u32,
    warmup: usize,
    repetitions: usize,
    max_iter: usize,
    tol: f64,
    out: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args {
        design_dir: PathBuf::new(),
        invocation: 1,
        seed: 1,
        warmup: 5,
        repetitions: 30,
        max_iter: 20,
        tol: 0.001,
        out: None,
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let value = argv.get(i + 1).ok_or_else(|| format!("{} needs a value", argv[i]))?;
        let bad = |e: &dyn std::fmt::Display| format!("{} {}: {}", argv[i], value, e);
        match argv[i].as_str() {
            "--design-dir" => a.design_dir = PathBuf::from(value),
            "--invocation" => a.invocation = value.parse().map_err(|e| bad(&e))?,
            "--seed" => a.seed = value.parse().map_err(|e| bad(&e))?,
            "--warmup" => a.warmup = value.parse().map_err(|e| bad(&e))?,
            "--repetitions" => a.repetitions = value.parse().map_err(|e| bad(&e))?,
            "--max-iter" => a.max_iter = value.parse().map_err(|e| bad(&e))?,
            "--tol" => a.tol = value.parse().map_err(|e| bad(&e))?,
            "--out" => a.out = Some(PathBuf::from(value)),
            other => return Err(format!("unknown argument {}", other)),
        }
        i += 2;
    }
    if a.design_dir.as_os_str().is_empty() {
        return Err("--design-dir is required".into());
    }
    Ok(a)
}

// --- PRNG urutan N: salinan mulberry32 + Fisher–Yates dari services/prng.ts ---

struct Mulberry32(u32);

impl Mulberry32 {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from((t ^ (t >> 14)) as u32) / 4_294_967_296.0
    }
}

fn shuffled(mut items: Vec<usize>, seed: u32) -> Vec<usize> {
    let mut rng = Mulberry32(seed);
    for i in (1..items.len()).rev() {
        let j = (rng.next() * (i + 1) as f64).floor() as usize;
        items.swap(i, j);
    }
    items
}

// --- SHA-256 (FIPS 180-4) ---

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256_hex(data: &[u8]) -> String {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    let mut w = [0u32; 64];
    for chunk in msg.chunks(64) {
        for (t, word) in chunk.chunks(4).enumerate() {
            w[t] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for t in 16..64 {
            let s0 = w[t - 15].rotate_right(7) ^ w[t - 15].rotate_right(18) ^ (w[t - 15] >> 3);
            let s1 = w[t - 2].rotate_right(17) ^ w[t - 2].rotate_right(19) ^ (w[t - 2] >> 10);
            w[t] = w[t - 16].wrapping_add(s0).wrapping_add(w[t - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for t in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[t]).wrapping_add(w[t]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for (hi, vi) in h.iter_mut().zip(v.iter()) {
            *hi = hi.wrapping_add(*vi);
        }
    }
    h.iter().map(|x| format!("{:08x}", x)).collect()
}

// --- Design matrix ---

struct Design {
    n: usize,
    p: usize,
    feature_names: Vec<String>,
    x: Vec<f64>,
    y: Vec<f64>,
}

fn read_f64_le(path: &Path, expected_sha: &str, expected_len: usize) -> Result<Vec<f64>, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let sha = sha256_hex(&bytes);
    if sha != expected_sha {
        return Err(format!("{}: SHA-256 {} differs from {}", path.display(), sha, expected_sha));
    }
    if bytes.len() != expected_len * 8 {
        return Err(format!("{}: {} bytes, expected {}", path.display(), bytes.len(), expected_len * 8));
    }
    Ok(bytes
        .chunks_exact(8)
        .map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]))
        .collect())
}

fn load_design(dir: &Path, size: usize) -> Result<Design, String> {
    let meta_path = dir.join(format!("N{}.json", size));
    let meta: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&meta_path).map_err(|e| format!("{}: {}", meta_path.display(), e))?,
    )
    .map_err(|e| format!("{}: {}", meta_path.display(), e))?;
    let n = meta["n"].as_u64().ok_or("n missing")? as usize;
    let p = meta["p"].as_u64().ok_or("p missing")? as usize;
    let feature_names: Vec<String> = meta["featureNames"]
        .as_array()
        .ok_or("featureNames missing")?
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_string())
        .collect();
    let sha_x = meta["sha256"]["X"].as_str().ok_or("sha256.X missing")?;
    let sha_y = meta["sha256"]["y"].as_str().ok_or("sha256.y missing")?;
    let x = read_f64_le(&dir.join(format!("N{}.X.f64", size)), sha_x, n * p)?;
    let y = read_f64_le(&dir.join(format!("N{}.y.f64", size)), sha_y, n)?;
    Ok(Design { n, p, feature_names, x, y })
}

/// Ukuran N yang tersedia di direktori design (N<N>.json).
fn available_sizes(dir: &Path) -> Result<Vec<usize>, String> {
    let mut sizes: Vec<usize> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {}", dir.display(), e))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.strip_prefix('N')?.strip_suffix(".json")?.parse().ok()
        })
        .collect();
    sizes.sort_unstable();
    Ok(sizes)
}

fn run(a: &Args) -> Result<(), String> {
    let sizes = available_sizes(&a.design_dir)?;
    if sizes.is_empty() {
        return Err(format!("no N<N>.json in {}", a.design_dir.display()));
    }
    let designs: Vec<(usize, Design)> = sizes
        .iter()
        .map(|&s| load_design(&a.design_dir, s).map(|d| (s, d)))
        .collect::<Result<_, _>>()?;
    let feature_names = designs[0].1.feature_names.clone();
    if designs.iter().any(|(_, d)| d.feature_names != feature_names) {
        return Err("featureNames differ between sizes".into());
    }

    let mut out: Box<dyn Write> = match &a.out {
        Some(p) => Box::new(fs::File::create(p).map_err(|e| format!("{}: {}", p.display(), e))?),
        None => Box::new(std::io::stdout()),
    };
    let mut header = vec!["invocation", "N", "p", "rep", "computeMs", "iterations", "converged", "neg2ll"]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
    header.extend(feature_names.iter().map(|f| format!("beta_{}", f)));
    header.extend(feature_names.iter().map(|f| format!("se_{}", f)));
    writeln!(out, "{}", header.join(",")).map_err(|e| e.to_string())?;

    let order = shuffled((0..designs.len()).collect(), a.seed);
    for idx in order {
        let (size, d) = &designs[idx];
        let reps = a.warmup + a.repetitions;
        for k in 0..reps {
            let t0 = Instant::now();
            let result = irls_core(&d.x, &d.y, d.n, d.p, a.max_iter, a.tol);
            let compute_ms = t0.elapsed().as_secs_f64() * 1000.0;
            let r = result.map_err(|e| format!("N = {}: {}", size, e))?;
            if k < a.warmup {
                continue;
            }
            let mut row = vec![
                a.invocation.to_string(),
                size.to_string(),
                d.p.to_string(),
                (k - a.warmup + 1).to_string(),
                format!("{:?}", compute_ms),
                r.iterations.to_string(),
                r.converged.to_string(),
                format!("{:?}", r.neg2ll),
            ];
            row.extend(r.beta.iter().map(|v| format!("{:?}", v)));
            row.extend(r.se.iter().map(|v| format!("{:?}", v)));
            writeln!(out, "{}", row.join(",")).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("irls_native_bench: {}", e);
            std::process::exit(2);
        }
    };
    if let Err(e) = run(&args) {
        eprintln!("irls_native_bench: {}", e);
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_vektor_standar() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        // Lebih dari satu blok dengan sisa 55/56 byte (batas padding)
        assert_eq!(sha256_hex(&[b'a'; 55]), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
        assert_eq!(sha256_hex(&[b'a'; 56]), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
    }

    #[test]
    fn mulberry32_sama_dengan_js() {
        // mulberry32(42) dari services/prng.ts: 0.6011037519201636, 0.44829055899754167, 0.8524657934904099
        let mut r = Mulberry32(42);
        assert_eq!(r.next(), 0.6011037519201636);
        assert_eq!(r.next(), 0.44829055899754167);
        assert_eq!(r.next(), 0.8524657934904099);
    }

    #[test]
    fn urutan_n_sama_dengan_shuffle_in_place_js() {
        // shuffleInPlace([0, 1, 2, 3], mulberry32(1005)) di JS = [0, 3, 2, 1]
        assert_eq!(shuffled((0..4).collect(), 1005), vec![0, 3, 2, 1]);
    }
}
