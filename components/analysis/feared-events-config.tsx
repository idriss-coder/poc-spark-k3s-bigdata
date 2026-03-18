"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { type DataSchemaEntry } from "@/app/lib/api";
import { Warning } from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FearedEventsConfigProps {
  /** Toutes les colonnes ayant use_in_analysis = true (depuis l'étape 1) */
  eligibleColumns: DataSchemaEntry[];
  /** Colonnes sélectionnées comme événements redoutés */
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FearedEventsConfig({
  eligibleColumns,
  selectedIds,
  onChange,
}: FearedEventsConfigProps) {
  const toggle = (name: string) => {
    const next = new Set(selectedIds);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === eligibleColumns.length) {
      onChange(new Set());
    } else {
      onChange(new Set(eligibleColumns.map((c) => c.name)));
    }
  };

  if (eligibleColumns.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <Warning size={16} className="mt-0.5 shrink-0" />
        <span>
          Aucune colonne sélectionnée à l&apos;étape 1. Cochez au moins une colonne dans
          &nbsp;<strong>Utiliser pour analyse</strong> pour pouvoir configurer les événements redoutés.
        </span>
      </div>
    );
  }

  const allChecked = selectedIds.size === eligibleColumns.length && eligibleColumns.length > 0;

  return (
    <div className="space-y-3">
      {/* Select all */}
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Checkbox
          id="feared-select-all"
          checked={allChecked}
          onCheckedChange={toggleAll}
        />
        <label
          htmlFor="feared-select-all"
          className="text-xs font-medium cursor-pointer"
        >
          Tout sélectionner ({eligibleColumns.length})
        </label>
        {selectedIds.size > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Column list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {eligibleColumns.map((col) => {
          const checked = selectedIds.has(col.name);
          return (
            <label
              key={col.name}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 cursor-pointer transition-colors border ${checked
                ? "border-primary/40 bg-primary/5 text-foreground"
                : "border-transparent hover:bg-muted/40 text-muted-foreground"
                }`}
            >
              <Checkbox
                id={`feared-${col.name}`}
                checked={checked}
                onCheckedChange={() => toggle(col.name)}
              />
              <span className="font-mono text-sm truncate flex-1" title={col.name}>
                {col.name}
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 h-4 font-mono shrink-0 capitalize"
              >
                {col.exhibition.replace(/_/g, " ")}
              </Badge>
            </label>
          );
        })}
      </div>
    </div>
  );
}
