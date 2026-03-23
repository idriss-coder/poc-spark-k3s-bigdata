"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ColumnInfo, type DataSchemaEntry, type DataSchemaExhibition } from "@/app/lib/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXHIBITION_OPTIONS: { value: DataSchemaExhibition; label: string; color: string }[] = [
  { value: "restricted_internal", label: "Restreint interne", color: "text-blue-600" },
  { value: "extended_internal", label: "Étendu interne", color: "text-indigo-600" },
  { value: "restricted_external", label: "Restreint externe", color: "text-amber-600" },
  { value: "extended_external", label: "Étendu externe", color: "text-red-600" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataSchemaConfigProps {
  columns: ColumnInfo[];
  schema: DataSchemaEntry[];
  onChange: (schema: DataSchemaEntry[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataSchemaConfig({ columns, schema, onChange }: DataSchemaConfigProps) {
  const updateEntry = (columnName: string, patch: Partial<DataSchemaEntry>) => {
    onChange(
      schema.map((entry) =>
        entry.name === columnName ? { ...entry, ...patch } : entry
      )
    );
  };

  const selectedCount = schema.filter((e) => e.use_in_analysis).length;
  const allChecked = selectedCount === schema.length && schema.length > 0;
  const selectAllState = allChecked ? true : selectedCount > 0 ? "indeterminate" : false;

  const toggleAll = () => {
    const nextValue = !allChecked;
    onChange(schema.map((entry) => ({ ...entry, use_in_analysis: nextValue })));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Checkbox
          id="schema-select-all"
          checked={selectAllState}
          onCheckedChange={toggleAll}
        />
        <label
          htmlFor="schema-select-all"
          className="text-xs font-medium text-foreground cursor-pointer"
        >
          Tout sélectionner ({schema.length})
        </label>
        {selectedCount > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            {/* Header */}
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-6">
                  <span className="sr-only">Utiliser</span>
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">
                  Colonne
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">
                  Type
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs min-w-[200px]">
                  Niveau d&apos;exposition
                </th>
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {schema.map((entry, idx) => {
                const col = columns.find((c) => c.name === entry.name);
                const isActive = entry.use_in_analysis;
                const exhibitionOption = EXHIBITION_OPTIONS.find(
                  (o) => o.value === entry.exhibition
                );

                return (
                  <tr
                    key={entry.name}
                    className={`border-b border-border last:border-0 transition-colors cursor-pointer ${isActive
                      ? "bg-primary/5 hover:bg-primary/10"
                      : "hover:bg-muted/30"
                      }`}
                    onClick={() => updateEntry(entry.name, { use_in_analysis: !isActive })}
                  >
                    {/* Checkbox */}
                    <td className="py-2.5 px-3">
                      <Checkbox
                        id={`col-vuln-${idx}`}
                        checked={isActive}
                        onCheckedChange={(checked) =>
                          updateEntry(entry.name, { use_in_analysis: Boolean(checked) })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>

                    {/* Name */}
                    <td className="py-2.5 px-3">
                      <label
                        htmlFor={`col-vuln-${idx}`}
                        className={`font-mono text-sm cursor-pointer ${isActive ? "text-foreground font-medium" : "text-muted-foreground"
                          }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.name}
                      </label>
                    </td>

                    {/* Type */}
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-mono">
                        {col?.type ?? "—"}
                      </Badge>
                    </td>

                    {/* Exhibition level */}
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={entry.exhibition}
                        onValueChange={(val) =>
                          updateEntry(entry.name, { exhibition: val as DataSchemaExhibition })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-full max-w-[200px]">
                          <SelectValue placeholder="Choisir…" />
                        </SelectTrigger>
                        <SelectContent>
                          {EXHIBITION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span className={`${opt.color} font-medium`}>{opt.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
