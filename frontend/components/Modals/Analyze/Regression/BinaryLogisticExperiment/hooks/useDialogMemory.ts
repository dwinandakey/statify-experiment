"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Variable } from "@/types/Variable";

/**
 * Memori dialog "Binary Logistic (Experiment)" selama halaman belum di-reload.
 *
 * Modal Statify di-unmount saat ditutup atau saat dialog lain dibuka di
 * atasnya, sehingga state React biasa hilang. Pilihan variabel, konfigurasi,
 * pengaturan, dan hasil Run once/batch disimpan di sini per kunci dan dipakai
 * lagi saat dialog dirender ulang. Memori dikosongkan bila dataset berganti
 * (jumlah baris atau daftar variabel berbeda). Hanya di memori: reload halaman
 * (dianjurkan sebelum batch final) memulai dari awal.
 */
const memory = new Map<string, unknown>();
let memorySignature: string | null = null;

/** Sidik dataset aktif: jumlah baris + id/nama/kolom setiap variabel. */
export function datasetSignature(variables: Variable[], rowCount: number): string {
  return `${rowCount}|${variables.map((v) => `${v.id}:${v.name}:${v.columnIndex}`).join(",")}`;
}

/** Panggil saat dialog mulai dirender, sebelum state lain dibaca. */
export function syncDialogMemory(signature: string): void {
  if (memorySignature !== signature) {
    memory.clear();
    memorySignature = signature;
  }
}

/** Seperti useState, tetapi nilai terakhir diingat di memori dialog. */
export function useDialogMemory<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  useEffect(() => {
    memory.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
