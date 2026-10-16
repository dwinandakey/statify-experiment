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
