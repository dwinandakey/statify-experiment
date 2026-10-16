"use client";

import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { BaseModalProps } from "@/types/modalTypes";
import type { Variable } from "@/types/Variable";
import type { ExperimentResults } from "../types/experiment";
import { covariateRejectionReason, prepareFromStores } from "../services/prepareData";
import { writeExperimentOutput } from "../services/outputWriter";
import { VariablesTab } from "./VariablesTab";
import { ExperimentTab } from "./ExperimentTab";

/**
 * Dialog "Binary Logistic (Experiment)": eksperimen faktorial 2×2
 * (JavaScript vs Rust-Wasm × main thread vs Web Worker) untuk inti IRLS
 * regresi logistik biner. Lihat ../EXPERIMENT.md.
 *
 * Modul Binary Logistic produksi tidak disentuh. Worker, formatter, dan
 * syntax generator produksi hanya dipakai ulang (read-only) untuk tombol
 * "Compare with production" dan untuk laporan SPSS di output viewer (OK).
 */
const EMPTY_RESULTS: ExperimentResults = { single: null, batch: null, comparison: null };

export const BinaryLogisticExperimentMain = ({ onClose }: BaseModalProps) => {
  const variablesFromStore = useVariableStore((state) => state.variables);
  const data = useDataStore((state) => state.data);

  const [activeTab, setActiveTab] = useState("variables");
  const [dependent, setDependent] = useState<Variable | null>(null);
  const [covariates, setCovariates] = useState<Variable[]>([]);
  const [highlightedVariable, setHighlightedVariable] = useState<Variable | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ExperimentResults>(EMPTY_RESULTS);
  const [isWriting, setIsWriting] = useState(false);

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

  // OK: laporan SPSS (pipeline produksi, Enter + default) + kartu hasil eksperimen bila ada
  const handleOk = async () => {
    let prepared;
    try {
      prepared = prepareFromStores(dependent, covariates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setIsWriting(true);
    try {
      const { experimentSections } = await writeExperimentOutput(prepared, results);
      toast.success(
        experimentSections > 0
          ? "Binary Logistic output and experiment results written to the output viewer."
          : "Binary Logistic output written to the output viewer (no experiment results yet)."
      );
      onClose();
    } catch (err) {
      toast.error(`Failed to write results: ${err instanceof Error ? err.message : String(err)}`);
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
                disabled={busy}
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
                onBusyChange={onBusyChange}
                onResultsChange={onResultsChange}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          Method: Enter · default options · categorical: Indicator (Last)
        </span>
        <div className="flex items-center space-x-4">
          <Button
            onClick={handleOk}
            disabled={busy || isWriting || !dependent || covariates.length === 0}
            data-testid="bl-exp-ok"
          >
            {isWriting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Writing...
              </>
            ) : (
              "OK"
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={busy}>
            Reset
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BinaryLogisticExperimentMain;
