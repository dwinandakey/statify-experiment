/**
 * PRNG ber-seed untuk eksperimen (resampling dan pengacakan urutan mode).
 * mulberry32: generator 32-bit sederhana, deterministik di semua browser.
 */

export type Rng = () => number;

/** Bilangan acak seragam [0, 1) dengan resolusi 2^-32. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turunkan seed baru dari seed dasar + label, supaya stream acak untuk
 * keperluan berbeda (mis. pengacakan urutan vs resampling) tidak saling
 * bergantung. Hash integer 32-bit (murmur3 finalizer).
 */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fisher–Yates in-place; mengembalikan array yang sama. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

// --- Stream acak dari orderSeed ---
// Urutan sel per repetisi memakai mulberry32(deriveSeed(orderSeed, N)) untuk setiap N (sama
// dengan v1 bila orderSeed = seed v1). Urutan N dan urutan workload memakai salt negatif,
// sehingga tidak pernah bertabrakan dengan stream per-N (N selalu positif).

export const SIZE_ORDER_SALT = -1;
export const WORKLOAD_ORDER_SALT = -2;

/** Stream acak urutan sel untuk ukuran N. */
export function cellOrderRng(orderSeed: number, N: number): Rng {
  return mulberry32(deriveSeed(orderSeed, N));
}

/** Urutan N untuk sizeOrder "shuffled": ukuran diurutkan naik lalu diacak dengan orderSeed. */
export function shuffledSizes(sizes: number[], orderSeed: number): number[] {
  const base = [...new Set(sizes)].sort((a, b) => a - b);
  return shuffleInPlace(base, mulberry32(deriveSeed(orderSeed, SIZE_ORDER_SALT)));
}

/**
 * Urutan workload satu sesi (dipakai orkestrator): daftar diurutkan dulu ("core" < "full")
 * lalu diacak dengan orderSeed. tests/experiment/orchestrate.mjs memakai salinan fungsi ini.
 */
export function shuffledWorkloads<T extends string>(workloads: T[], orderSeed: number): T[] {
  const base = [...new Set(workloads)].sort();
  return shuffleInPlace(base, mulberry32(deriveSeed(orderSeed, WORKLOAD_ORDER_SALT)));
}
