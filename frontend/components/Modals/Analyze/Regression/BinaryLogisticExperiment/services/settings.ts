/**
 * Pengaturan batch: pembacaan meta.json lama (v1) ke bentuk BatchSettings v2.
 *
 * v1 menyimpan `seed` (dipakai untuk resampling DAN urutan mode) dan `coldWorkers`
 * (true = worker per-run). Batch v1 selalu resample dengan pengembalian dan N naik.
 */
import type { BatchSettings, Lifecycle, Sampling, SizeOrder, Workload } from "../types/experiment";
import { DEFAULT_MAX_ITER, DEFAULT_TOL } from "../types/experiment";

const LIFECYCLES: Lifecycle[] = ["persistent", "per-run", "interleaved"];
const SAMPLINGS: Sampling[] = ["resample", "prefix"];
const SIZE_ORDERS: SizeOrder[] = ["ascending", "shuffled"];

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Pengaturan dari meta.json v1 atau v2 → BatchSettings v2. */
export function normalizeBatchSettings(raw: Record<string, unknown>): BatchSettings {
  const legacySeed = isInt(raw.seed) ? raw.seed : undefined;
  const dataSeed = isInt(raw.dataSeed) ? raw.dataSeed : legacySeed;
  const orderSeed = isInt(raw.orderSeed) ? raw.orderSeed : legacySeed;
  if (dataSeed === undefined || orderSeed === undefined) throw new Error("Batch settings have no seed (dataSeed/orderSeed or legacy seed).");

  let lifecycle: Lifecycle;
  if (LIFECYCLES.includes(raw.lifecycle as Lifecycle)) lifecycle = raw.lifecycle as Lifecycle;
  else if (typeof raw.coldWorkers === "boolean") lifecycle = raw.coldWorkers ? "per-run" : "persistent";
  else throw new Error("Batch settings have no lifecycle (or legacy coldWorkers).");

  return {
    workload: raw.workload === "full" ? "full" : ("core" as Workload),
    sizes: Array.isArray(raw.sizes) ? raw.sizes.map(Number) : [],
    warmup: Number(raw.warmup),
    repetitions: Number(raw.repetitions),
    dataSeed,
    orderSeed,
    // Batch v1 tidak punya field ini: resample + urutan N naik
    sampling: SAMPLINGS.includes(raw.sampling as Sampling) ? (raw.sampling as Sampling) : "resample",
    sizeOrder: SIZE_ORDERS.includes(raw.sizeOrder as SizeOrder) ? (raw.sizeOrder as SizeOrder) : "ascending",
    lifecycle,
    maxIter: isInt(raw.maxIter) ? raw.maxIter : DEFAULT_MAX_ITER,
    tol: typeof raw.tol === "number" ? raw.tol : DEFAULT_TOL,
  };
}

/** Kolom CSV lama `coldWorkers`: pengaturan batch v1; kosong untuk batch interleaved (campuran). */
export function legacyColdWorkers(lifecycle: Lifecycle): boolean | null {
  return lifecycle === "interleaved" ? null : lifecycle === "per-run";
}
