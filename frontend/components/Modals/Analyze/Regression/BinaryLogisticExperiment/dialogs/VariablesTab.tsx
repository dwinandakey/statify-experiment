"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Ruler, Shapes, BarChartHorizontal, ListTree, Target, Layers } from "lucide-react";
import type { Variable } from "@/types/Variable";
import { cn } from "@/lib/utils";

// Pola pemilihan variabel (klik, Ctrl/Shift multi-select, drag-and-drop)
// mengikuti BinaryLogistic/dialogs/VariablesTab.tsx produksi. Bedanya: tidak
// ada pilihan metode (selalu Enter) dan kovariat hanya numerik.

interface VariablesTabProps {
  availableVariables: Variable[];
  selectedDependent: Variable | null;
  selectedCovariates: Variable[];
  highlightedVariable: Variable | null;
  setHighlightedVariable: (v: Variable | null) => void;
  onMoveToDependent: (vars: Variable[]) => void;
  onMoveToCovariates: (vars: Variable[]) => void;
  onRemoveDependent: () => void;
  onRemoveCovariate: (v: Variable) => void;
  disabled?: boolean;
}

const getVariableIcon = (variable: Variable) => {
  const cls = "text-muted-foreground mr-1.5 flex-shrink-0";
  switch (variable.measure) {
    case "scale":
      return <Ruler size={14} className={cls} />;
    case "ordinal":
      return <BarChartHorizontal size={14} className={cls} />;
    default:
      return <Shapes size={14} className={cls} />;
  }
};

const getDisplayName = (variable: Variable) => variable.label || variable.name;

export const VariablesTab: React.FC<VariablesTabProps> = ({
  availableVariables,
  selectedDependent,
  selectedCovariates,
  highlightedVariable,
  setHighlightedVariable,
  onMoveToDependent,
  onMoveToCovariates,
  onRemoveDependent,
  onRemoveCovariate,
  disabled = false,
}) => {
  const [selectedVarIds, setSelectedVarIds] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<"dependent" | "covariates" | null>(null);

  const selectedVars = availableVariables.filter((v) => selectedVarIds.includes(String(v.id)));

  const handleSelect = (v: Variable, e: React.MouseEvent<HTMLDivElement>) => {
    const multiSelect = e.ctrlKey || e.metaKey;
    const useRangeSelect = e.shiftKey && lastSelectedIndex !== null;
    const varId = String(v.id);
    const currentIndex = availableVariables.findIndex((item) => String(item.id) === varId);
    if (currentIndex < 0) return;

    if (useRangeSelect) {
      const start = Math.min(lastSelectedIndex!, currentIndex);
      const end = Math.max(lastSelectedIndex!, currentIndex);
      const rangeIds = availableVariables.slice(start, end + 1).map((item) => String(item.id));
      setSelectedVarIds((prev) => (multiSelect ? Array.from(new Set([...prev, ...rangeIds])) : rangeIds));
      setLastSelectedIndex(currentIndex);
      setHighlightedVariable(v);
      return;
    }

    if (multiSelect) {
      setSelectedVarIds((prev) => (prev.includes(varId) ? prev.filter((id) => id !== varId) : [...prev, varId]));
      setLastSelectedIndex(currentIndex);
      setHighlightedVariable(v);
      return;
    }

    const isAlreadySelected = selectedVarIds.length === 1 && selectedVarIds[0] === varId;
    setSelectedVarIds(isAlreadySelected ? [] : [varId]);
    setLastSelectedIndex(currentIndex);
    setHighlightedVariable(isAlreadySelected ? null : v);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, draggedVar: Variable) => {
    const draggedId = String(draggedVar.id);
    const idsToDrag = selectedVarIds.includes(draggedId) ? selectedVarIds : [draggedId];
    if (!selectedVarIds.includes(draggedId)) setSelectedVarIds([draggedId]);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/statify-variable-ids", JSON.stringify(idsToDrag));
  };

  const handleDropToTarget = (e: React.DragEvent<HTMLDivElement>, target: "dependent" | "covariates") => {
    e.preventDefault();
    setDragOverTarget(null);
    if (disabled) return;
    const raw = e.dataTransfer.getData("application/statify-variable-ids");
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      const dropped = availableVariables.filter((v) => ids.includes(String(v.id)));
      if (dropped.length === 0) return;
      if (target === "dependent") onMoveToDependent(dropped);
      else onMoveToCovariates(dropped);
      setSelectedVarIds([]);
      setHighlightedVariable(null);
    } catch {
      // Abaikan payload drag yang tidak valid
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, target: "dependent" | "covariates") => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(target);
  };

  const currentSelection = (): Variable[] => {
    if (selectedVars.length > 0) return selectedVars;
    return highlightedVariable ? [highlightedVariable] : [];
  };

  const moveSelection = (target: "dependent" | "covariates") => {
    const vars = currentSelection();
    if (vars.length === 0) return;
    if (target === "dependent") onMoveToDependent(vars);
    else onMoveToCovariates(vars);
    setSelectedVarIds([]);
    setHighlightedVariable(null);
  };

  const hasSelection = selectedVars.length > 0 || !!highlightedVariable;

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-6 py-4 flex-grow min-h-0">
        {/* Kiri: variabel tersedia */}
        <div className="col-span-1 flex flex-col h-full min-h-0">
          <label className="font-semibold mb-2 text-sm flex items-center gap-1.5">
            <ListTree className="h-4 w-4 text-primary" />
            Variables:
          </label>
          <div className="border border-border rounded-md flex-1 bg-background overflow-hidden shadow-sm min-h-[240px]">
            <ScrollArea className="h-full p-2 pr-3">
              {availableVariables.map((variable) => (
                <div
                  key={variable.id ?? variable.name}
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, variable)}
                  className={cn(
                    "flex items-center p-1.5 mb-1 cursor-pointer border rounded-md text-sm transition-colors",
                    selectedVarIds.includes(String(variable.id)) || highlightedVariable?.name === variable.name
                      ? "bg-primary/10 text-primary border-primary"
                      : "border-muted-foreground/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                  )}
                  onClick={(e) => handleSelect(variable, e)}
                  title="Click to select, drag to move"
                  data-testid={`bl-exp-variable-item-${variable.name}`}
                >
                  {getVariableIcon(variable)}
                  <span className="truncate">{getDisplayName(variable)}</span>
                </div>
              ))}
            </ScrollArea>
          </div>
        </div>

        {/* Kanan: target */}
        <div className="col-span-1 flex flex-col gap-4 min-h-0 h-full overflow-y-auto pr-2 pb-2">
          <div className="flex items-start gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="mt-6 shrink-0 h-8 w-8"
              onClick={() => moveSelection("dependent")}
              disabled={disabled || !hasSelection || !!selectedDependent}
              aria-label="Move to dependent"
              data-testid="bl-exp-move-to-dependent"
            >
              <ChevronRight size={16} />
            </Button>
            <div className="flex-1 min-w-0">
              <label className="font-semibold mb-2 text-sm flex items-center gap-1.5">
                <Target className="h-4 w-4 text-primary" />
                Dependent (binary):
              </label>
              <div
                className={cn(
                  "border border-border rounded-md min-h-[40px] p-2 bg-background transition-colors shadow-sm",
                  dragOverTarget === "dependent" && "border-primary bg-primary/5 ring-1 ring-primary/30"
                )}
                onDragOver={(e) => handleDragOver(e, "dependent")}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDropToTarget(e, "dependent")}
                data-testid="bl-exp-dependent-box"
              >
                {selectedDependent ? (
                  <div
                    className="flex items-center text-sm border border-muted-foreground/30 rounded-md p-1.5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-colors cursor-pointer"
                    onClick={() => !disabled && onRemoveDependent()}
                    title="Click to remove"
                  >
                    {getVariableIcon(selectedDependent)}
                    <span className="truncate">{getDisplayName(selectedDependent)}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">Select or drag variable...</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 flex-1 min-h-0">
            <Button
              variant="outline"
              size="icon"
              className="mt-6 shrink-0 h-8 w-8"
              onClick={() => moveSelection("covariates")}
              disabled={disabled || !hasSelection}
              aria-label="Move to covariates"
              data-testid="bl-exp-move-to-covariates"
            >
              <ChevronRight size={16} />
            </Button>
            <div className="flex-1 min-w-0">
              <label className="font-semibold mb-2 text-sm flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-primary" />
                Covariates (numeric):
              </label>
              <div
                className={cn(
                  "border border-border rounded-md bg-background min-h-[200px] h-auto p-2 transition-colors shadow-sm",
                  dragOverTarget === "covariates" && "border-primary bg-primary/5 ring-1 ring-primary/30"
                )}
                onDragOver={(e) => handleDragOver(e, "covariates")}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDropToTarget(e, "covariates")}
                data-testid="bl-exp-covariates-box"
              >
                {selectedCovariates.length === 0 && (
                  <div className="text-xs text-muted-foreground italic p-1">Select or drag variables...</div>
                )}
                {selectedCovariates.map((v) => (
                  <div
                    key={v.id ?? v.name}
                    className="flex items-center p-1.5 mb-1 rounded-md cursor-pointer hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 border border-muted-foreground/30 text-sm transition-colors"
                    onClick={() => !disabled && onRemoveCovariate(v)}
                    title="Click to remove"
                  >
                    {getVariableIcon(v)}
                    <span className="truncate">{getDisplayName(v)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Scale variables only. Nominal, ordinal, and string variables are rejected because this experiment has no
                Categorical tab.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border/50 flex-shrink-0 mb-2 text-sm">
        <span className="font-medium">Method:</span>
        <span className="rounded-md border border-border bg-muted px-2 py-0.5" data-testid="bl-exp-method-label">
          Enter
        </span>
      </div>
    </div>
  );
};
