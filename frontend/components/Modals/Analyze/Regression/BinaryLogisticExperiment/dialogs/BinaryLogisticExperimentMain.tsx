"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { BaseModalProps } from "@/types/modalTypes";
import type { Variable } from "@/types/Variable";
import type { ExperimentMode, ExperimentResults } from "../types/experiment";
import { MODES } from "../types/experiment";
import { covariateRejectionReason, prepareFromStores } from "../services/prepareData";
import { writeExperimentOutput } from "../services/outputWriter";
import { ExperimentSession } from "../services/runner";
import { interRunPause } from "../services/metrics";
import { datasetSignature, syncDialogMemory, useDialogMemory } from "../hooks/useDialogMemory";
import { VariablesTab } from "./VariablesTab";
import { ExperimentTab } from "./ExperimentTab";

/**
 * Dialog "Binary Logistic (Experiment)": eksperimen faktorial 2×2
 * (JavaScript vs Rust-Wasm × main thread vs Web Worker) untuk regresi
 * logistik biner. Lihat ../EXPERIMENT.md.
 *
 * - Run once / batch (tab Experiment) mengukur inti IRLS atau analisis lengkap.
 * - OK menjalankan analisis Binary Logistic lengkap (Enter, opsi default) pada
 *   konfigurasi terpilih dan menulis tabel SPSS + laporan performa. Dialog
 *   tetap terbuka (berbeda dengan dialog produksi) agar OK bisa diulang
 *   dengan konfigurasi lain; pilihan dan hasil diingat walau dialog ditutup.
 *
 * Modul Binary Logistic produksi tidak disentuh; formatter dan syntax
 * generator produksi hanya dipakai ulang (read-only).
 */
const EMPTY_RESULTS: ExperimentResults = { single: null, batches: { core: null, full: null }, comparison: null };

export const BinaryLogisticExperimentMain = ({ onClose }: BaseModalProps) => {
  const variablesFromStore = useVariableStore((state) => state.variables);
  const data = useDataStore((state) => state.data);

  // Memori dialog dikosongkan bila dataset berganti; harus sebelum state di bawah dibaca
  const memorySynced = useRef(false);
  if (!memorySynced.current) {
    syncDialogMemory(datasetSignature(variablesFromStore, data.length));
    memorySynced.current = true;
  }

  const [activeTab, setActiveTab] = useDialogMemory("activeTab", "variables");
  const [dependent, setDependent] = useDialogMemory<Variable | null>("dependent", null);
  const [covariates, setCovariates] = useDialogMemory<Variable[]>("covariates", []);
  const [highlightedVariable, setHighlightedVariable] = useState<Variable | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ExperimentResults>(EMPTY_RESULTS);
  const [isWriting, setIsWriting] = useState(false);
  const [mode, setMode] = useDialogMemory<ExperimentMode>("mode", "A");
  const [coldWorkers, setColdWorkers] = useDialogMemory("coldWorkers", false);
  const [includeSpss, setIncludeSpss] = useDialogMemory("includeSpss", true);
  const [lastOk, setLastOk] = useDialogMemory<{ count: number; mode: ExperimentMode; includeSpss: boolean } | null>(
    "lastOk",
    null
  );

  // Sesi (monitor frame, observer long task, worker) hidup selama dialog terbuka
  const [session, setSession] = useState<ExperimentSession | null>(null);
  useEffect(() => {
    const s = new ExperimentSession();
    setSession(s);
    return () => s.dispose();
  }, []);

  const availableVariables = useMemo(() => {
    const selected = new Set([dependent?.id, ...covariates.map((v) => v.id)]);
    return variablesFromStore.filter((v) => !selected.has(v.id));
  }, [variablesFromStore, dependent, covariates]);

  // Validasi biner sama seperti BinaryLogisticMain.tsx produksi
  const handleMoveToDependent = (vars: Variable[]) => {
    const v = vars[0];
    if (!v) return;
    if (data.length > 0) {
      const unique = new Set(
        data.map((row) => row[v.columnIndex]).filter((val) => val !== null && val !== undefined && val !== "")
      );
      if (unique.size !== 2) {
        toast.error(
          `Variable "${v.label || v.name}" has ${unique.size} unique value(s). Dependent variable must have exactly 2 unique values (binary outcome).`
        );
        return;
      }
    }
    setDependent(v);
    setHighlightedVariable(null);
  };

  // Nominal/ordinal diterima sebagai kategorik (Indicator, Last), seperti default produksi
  const handleMoveToCovariates = (vars: Variable[]) => {
    const accepted: Variable[] = [];
    for (const v of vars) {
      const reason = covariateRejectionReason(v);
      if (reason) toast.error(reason);
      else accepted.push(v);
    }
    if (accepted.length === 0) return;
    setCovariates((prev) => {
      const ids = new Set(prev.map((v) => v.id));
      return [...prev, ...accepted.filter((v) => !ids.has(v.id))];
    });
    setHighlightedVariable(null);
  };

  const handleReset = () => {
    setDependent(null);
    setCovariates([]);
    setHighlightedVariable(null);
  };

  // OK: analisis lengkap pada konfigurasi terpilih → tabel SPSS + laporan performa; dialog tetap terbuka
  const handleOk = async () => {
    if (!session) return;
    let prepared;
    try {
      prepared = prepareFromStores(dependent, covariates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setIsWriting(true);
    try {
      // Biarkan status "Running…" ter-render sebelum main thread mungkin terblokir (mode A/C)
      await interRunPause();
      const okRun = await session.runFull(mode, prepared, { coldWorkers });
      if (okRun.error) throw new Error(okRun.error);
      await writeExperimentOutput(prepared, results, okRun, { includeSpss });
      setLastOk((prev) => ({ count: (prev?.count ?? 0) + 1, mode, includeSpss }));
      toast.success(
        `${includeSpss ? "SPSS tables and performance report" : "Performance report"} written (${MODES[mode].label}).`
      );
    } catch (err) {
      toast.error(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsWriting(false);
    }
  };

  const onBusyChange = useCallback((b: boolean) => setBusy(b), []);
  const onResultsChange = useCallback((r: ExperimentResults) => setResults(r), []);

  return (
    <div className="flex flex-col h-full bg-background" data-testid="bl-exp-dialog">
      <div className="flex-grow px-6 py-3 min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="variables" data-testid="bl-exp-tab-variables">
              Variables
            </TabsTrigger>
            <TabsTrigger value="experiment" data-testid="bl-exp-tab-experiment">
              Experiment
            </TabsTrigger>
          </TabsList>
          <div className="flex-grow min-h-0">
            <TabsContent value="variables" className="h-full mt-0">
              <VariablesTab
                availableVariables={availableVariables}
                selectedDependent={dependent}
                selectedCovariates={covariates}
                highlightedVariable={highlightedVariable}
                setHighlightedVariable={setHighlightedVariable}
                onMoveToDependent={handleMoveToDependent}
                onMoveToCovariates={handleMoveToCovariates}
                onRemoveDependent={() => setDependent(null)}
                onRemoveCovariate={(v) => setCovariates((prev) => prev.filter((c) => c.id !== v.id))}
                disabled={busy || isWriting}
              />
            </TabsContent>
            {/* forceMount: batch dan worker tetap hidup saat pindah ke tab Variables */}
            <TabsContent
              value="experiment"
              forceMount
              className="h-full mt-0 overflow-y-auto pr-1 data-[state=inactive]:hidden"
            >
              <ExperimentTab
                dependent={dependent}
                covariates={covariates}
                active={activeTab === "experiment"}
                session={session}
                mode={mode}
                onModeChange={setMode}
                coldWorkers={coldWorkers}
                onColdWorkersChange={setColdWorkers}
                includeSpss={includeSpss}
                onIncludeSpssChange={setIncludeSpss}
                locked={isWriting}
                onBusyChange={onBusyChange}
                onResultsChange={onResultsChange}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="px-6 py-3 border-t border-border flex flex-wrap items-center justify-between gap-2 bg-secondary flex-shrink-0">
        <div className="min-w-0 text-xs text-muted-foreground">
          <div data-testid="bl-exp-ok-config">
            OK: {MODES[mode].label} · Enter · default options ·{" "}
            {includeSpss ? "SPSS tables + performance" : "performance only"}
          </div>
          {lastOk && (
            <div data-testid="bl-exp-ok-status" data-count={lastOk.count}>
              Written {lastOk.count}× · last: {MODES[lastOk.mode].label}
              {lastOk.includeSpss ? "" : " (performance only)"} · see the output viewer
            </div>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <Button
            onClick={handleOk}
            disabled={busy || isWriting || !session || !dependent || covariates.length === 0}
            data-testid="bl-exp-ok"
          >
            {isWriting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              "OK"
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={busy || isWriting} data-testid="bl-exp-reset">
            Reset
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy || isWriting} data-testid="bl-exp-close">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BinaryLogisticExperimentMain;
