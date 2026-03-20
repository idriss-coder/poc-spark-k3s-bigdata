"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner, Lightning, CheckCircle } from "@phosphor-icons/react";
import { type ColumnInfo, type ResultResponse } from "@/app/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AverageResultsProps {
  columns: ColumnInfo[];
  columnsLoading: boolean;
  selectedColumns: Set<string>;
  onToggleColumn: (name: string) => void;
  onToggleAll: () => void;
  isNumericType: (type: string) => boolean;
  analysisLoading: boolean;
  analysisError: string | null;
  onLaunchAnalysis: () => void;
  result: ResultResponse | null;
  resultLoading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AverageResults({
  columns,
  columnsLoading,
  selectedColumns,
  onToggleColumn,
  onToggleAll,
  isNumericType,
  analysisLoading,
  analysisError,
  onLaunchAnalysis,
  result,
  resultLoading,
}: AverageResultsProps) {
  const numericColumns = columns.filter((c) => isNumericType(c.type));
  const allSelected = selectedColumns.size === numericColumns.length && selectedColumns.size > 0;

  return (
    <div className="space-y-4">
      {/* Column selection */}
      {columnsLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-36" />
        </div>
      ) : columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune colonne disponible. Le schéma Parquet n&apos;a pas encore été lu.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Checkbox
              id="avg-select-all"
              checked={allSelected}
              onCheckedChange={onToggleAll}
            />
            <label htmlFor="avg-select-all" className="text-xs font-medium text-foreground cursor-pointer">
              Tout sélectionner (numériques uniquement)
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {columns.map((col) => {
              const isNum = isNumericType(col.type);
              return (
                <div
                  key={col.name}
                  className={`flex items-center justify-between py-1 px-2 rounded transition-colors ${
                    isNum ? "hover:bg-muted/50 cursor-pointer" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Checkbox
                      id={`avg-col-${col.name}`}
                      checked={selectedColumns.has(col.name)}
                      onCheckedChange={() => isNum && onToggleColumn(col.name)}
                      disabled={!isNum}
                    />
                    <label
                      htmlFor={`avg-col-${col.name}`}
                      className={`text-sm truncate ${
                        isNum ? "text-foreground cursor-pointer" : "text-muted-foreground cursor-not-allowed"
                      }`}
                      title={!isNum ? "Seules les colonnes numériques peuvent être analysées (moyenne)." : ""}
                    >
                      {col.name}
                    </label>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-mono ml-2 shrink-0">
                    {col.type}
                  </Badge>
                </div>
              );
            })}
          </div>


        </>
      )}

      {/* Error */}
      {analysisError && (
        <p className="text-sm text-destructive">{analysisError}</p>
      )}

      {/* Launch button */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={onLaunchAnalysis}
          disabled={analysisLoading || selectedColumns.size === 0}
        >
          {analysisLoading ? (
            <>
              <Spinner size={14} className="animate-spin" />
              Lancement…
            </>
          ) : (
            <>
              <Lightning size={14} />
              Analyser {selectedColumns.size > 0 && `(${selectedColumns.size})`}
            </>
          )}
        </Button>
        {selectedColumns.size > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedColumns.size} colonne{selectedColumns.size > 1 ? "s" : ""} sélectionnée{selectedColumns.size > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Results table */}
      {result && result.preview.length > 0 && (
        <div className="mt-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600" />
            Résultats — Aperçu
          </h4>
          {resultLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-foreground">Aperçu JSON</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((value, index) => (
                    <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 text-foreground font-mono whitespace-pre-wrap">
                        {JSON.stringify(value, null, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
