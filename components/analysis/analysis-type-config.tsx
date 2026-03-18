"use client";

import { type ColumnInfo, type AnalysisType } from "@/app/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowsDownUp, ArrowRight } from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AnalysisTypeConfigProps {
  analysisType: AnalysisType;
  longitudinalColumn: string | null;
  columns: ColumnInfo[];
  onChange: (type: AnalysisType, longitudinalColumn: string | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalysisTypeConfig({
  analysisType,
  longitudinalColumn,
  columns,
  onChange,
}: AnalysisTypeConfigProps) {
  return (
    <div className="space-y-4">
      {/* Toggle buttons */}
      <div className="grid grid-cols-2 gap-3">
        {/* Longitudinal */}
        <button
          type="button"
          onClick={() => onChange("longitudinal", longitudinalColumn)}
          className={`relative flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all ${analysisType === "longitudinal"
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border hover:border-muted-foreground/40 text-muted-foreground hover:bg-muted/30"
            }`}
        >
          <div className="flex items-center gap-2">
            <ArrowRight size={16} className={analysisType === "longitudinal" ? "text-primary" : ""} />
            <span className="text-sm font-semibold">Longitudinal</span>
          </div>
          <p className="text-xs leading-relaxed opacity-75">
            Analyse dans le temps — nécessite une colonne temporelle.
          </p>
          {analysisType === "longitudinal" && (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
          )}
        </button>

        {/* Transversal */}
        <button
          type="button"
          onClick={() => onChange("transversal", null)}
          className={`relative flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all ${analysisType === "transversal"
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border hover:border-muted-foreground/40 text-muted-foreground hover:bg-muted/30"
            }`}
        >
          <div className="flex items-center gap-2">
            <ArrowsDownUp size={16} className={analysisType === "transversal" ? "text-primary" : ""} />
            <span className="text-sm font-semibold">Transversal</span>
          </div>
          <p className="text-xs leading-relaxed opacity-75">
            Analyse à un instant T — pas de colonne temporelle requise.
          </p>
          {analysisType === "transversal" && (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
      </div>

      {/* Column picker for longitudinal */}
      {analysisType === "longitudinal" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Colonne temporelle <span className="text-destructive">*</span>
          </label>
          <Select
            value={longitudinalColumn ?? ""}
            onValueChange={(val) => onChange("longitudinal", val || null)}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Sélectionner une colonne…" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((col) => (
                <SelectItem key={col.name} value={col.name}>
                  <span className="font-mono">{col.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{col.type}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
