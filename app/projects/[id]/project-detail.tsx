"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getProject,
  getProjectColumns,
  getProgress,
  getResult,
  launchAnalysis,
  deleteProject,
  formatBytes,
  computeCompressionStats,
  type ProjectDetail,
  type ProgressResponse,
  type ResultResponse,
} from "@/app/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChartBar, Lightning, Spinner, CheckCircle, XCircle, Clock, ArrowsClockwise, Trash, Database } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
  uploaded: { label: "Uploadé", variant: "secondary", icon: <Clock size={14} /> },
  converting: { label: "Conversion", variant: "default", icon: <ArrowsClockwise size={14} className="animate-spin" /> },
  ready: { label: "Prêt", variant: "outline", icon: <CheckCircle size={14} /> },
  analysing: { label: "Analyse", variant: "default", icon: <Spinner size={14} className="animate-spin" /> },
  completed: { label: "Terminé", variant: "outline", icon: <CheckCircle size={14} /> },
  failed: { label: "Échoué", variant: "destructive", icon: <XCircle size={14} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "secondary" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="gap-1 text-xs">
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

function parseUtcDate(iso: string) {
  if (!iso) return new Date();
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z');
}

function formatDate(iso: string) {
  try {
    return parseUtcDate(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string) {
  try {
    return parseUtcDate(iso).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return iso;
  }
}

function formatDuration(startISO: string, endISO: string): string {
  try {
    const start = parseUtcDate(startISO).getTime();
    const end = parseUtcDate(endISO).getTime();
    if (isNaN(start) || isNaN(end)) return "";

    // En millisecondes, convert en secondes
    const diff_seconds = Math.max(0, Math.floor((end - start) / 1000));

    if (diff_seconds < 60) return `${diff_seconds}s`;

    const minutes = Math.floor(diff_seconds / 60);
    const seconds = diff_seconds % 60;
    return `${minutes}m ${seconds}s`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectDetailContent({ projectId }: { projectId: number }) {
  // project data
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // columns
  const [columns, setColumns] = useState<import("@/app/lib/api").ColumnInfo[]>([]);
  const [preview, setPreview] = useState<Record<string, any>[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [columnsLoading, setColumnsLoading] = useState(false);

  // analysis
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // progress
  const [progress, setProgress] = useState<ProgressResponse | null>(null);

  // results
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [resultLoading, setResultLoading] = useState(false);

  // deletion
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Fetch project
  // -------------------------------------------------------------------------
  const fetchProject = useCallback(async () => {
    try {
      const p = await getProject(projectId);
      setProject(p);
      return p;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement.");
      return null;
    }
  }, [projectId]);

  // -------------------------------------------------------------------------
  // Fetch columns (when ready)
  // -------------------------------------------------------------------------
  const fetchColumns = useCallback(async () => {
    setColumnsLoading(true);
    try {
      const res = await getProjectColumns(projectId);
      setColumns(res.columns);
      setPreview(res.preview ?? []);
    } catch {
      setColumns([]);
      setPreview([]);
    } finally {
      setColumnsLoading(false);
    }
  }, [projectId]);

  // -------------------------------------------------------------------------
  // Fetch result (when completed)
  // -------------------------------------------------------------------------
  const fetchResult = useCallback(async () => {
    setResultLoading(true);
    try {
      const res = await getResult(projectId);
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setResultLoading(false);
    }
  }, [projectId]);

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const prog = await getProgress(projectId);
        setProgress(prog);
        // Refresh project to catch status changes
        const p = await getProject(projectId);
        setProject(p);

        if (p.status === "ready") {
          // Conversion done → stop polling, fetch columns
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          fetchColumns();
        } else if (p.status === "completed") {
          // Analysis done → stop polling, fetch results
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          fetchResult();
        } else if (p.status === "failed") {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }
      } catch {
        // silently retry on next tick
      }
    }, 1500);
  }, [projectId, fetchColumns, fetchResult]);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      setLoading(true);
      const p = await fetchProject();
      setLoading(false);
      if (!p) return;

      if (p.status === "converting" || p.status === "analysing") {
        startPolling();
      } else if (p.status === "ready") {
        fetchColumns();
      } else if (p.status === "completed") {
        fetchResult();
      }
    })();

    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // -------------------------------------------------------------------------
  // Submit analysis
  // -------------------------------------------------------------------------
  const handleLaunchAnalysis = async () => {
    if (selectedColumns.size === 0) {
      setAnalysisError("Sélectionnez au moins une colonne.");
      return;
    }
    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      await launchAnalysis(projectId, Array.from(selectedColumns));
      // Refresh project status
      const p = await fetchProject();
      if (p && (p.status === "analysing")) {
        setProgress({ status: "analysing", progress: 0, message: "Démarrage…", step: "analyse" });
        startPolling();
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Erreur lors du lancement.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Column toggle
  // -------------------------------------------------------------------------
  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const toggleAll = () => {
    // Only select numeric columns
    const numericColumns = columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
    if (selectedColumns.size === numericColumns.length) {
      setSelectedColumns(new Set());
    } else {
      setSelectedColumns(new Set(numericColumns));
    }
  };

  const isNumericType = (type: string) => {
    const t = type.toLowerCase();
    return t.includes("int") || t.includes("double") || t.includes("float") || t.includes("decimal") || t.includes("long") || t.includes("short");
  };

  // -------------------------------------------------------------------------
  // Delete project
  // -------------------------------------------------------------------------
  const handleDelete = async () => {
    if (!confirm("Voulez-vous vraiment supprimer ce projet ? Les fichiers sur S3 seront également effacés.")) return;
    setIsDeleting(true);
    try {
      await deleteProject(projectId);
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la suppression.");
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={16} /> Retour
        </Link>
        <p className="text-sm text-destructive">{error ?? "Projet introuvable."}</p>
      </div>
    );
  }

  const isPolling = project.status === "converting" || project.status === "analysing";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={16} /> Projets
      </Link>

      {/* Project header card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {project.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Créé le {formatDate(project.created_at)} — ID {project.id}
            </p>
            {(project.csv_size_bytes || project.parquet_size_bytes) && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                CSV: {project.csv_size_bytes ? formatBytes(project.csv_size_bytes) : "—"}
                {project.parquet_size_bytes && (
                  <span className="text-primary font-medium ml-2 border-l border-border pl-2">
                    Parquet: {formatBytes(project.parquet_size_bytes)}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={project.status} />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
              onClick={handleDelete}
              disabled={isPolling || isDeleting}
              title="Supprimer le projet"
            >
              {isDeleting ? <Spinner size={14} className="animate-spin" /> : <Trash size={14} />}
            </Button>
          </div>
        </CardHeader>

        {/* Progress bar during converting / analysing */}
        {isPolling && (
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {project.status === "converting"
                    ? (progress?.progress === 0 ? "Démarrage du cluster Spark (allocation des ressources)..." : "Conversion CSV → Parquet")
                    : (progress?.progress === 0 ? "Démarrage du cluster Spark (réveil des exécuteurs)..." : "Analyse Spark en cours")}
                </span>
                <span>{progress?.progress ?? 0}%</span>
              </div>
              <Progress value={progress?.progress ?? 0} className="h-2" />
              {progress?.message && (
                <p className="text-xs text-muted-foreground">{progress.message}</p>
              )}
            </div>
          </CardContent>
        )}

        {/* Execution Timeline Integration */}
        {(project.convert_ended_at || project.convert_started_at || (result && result.ended_at)) && (
          <CardContent className={`pt-0 ${isPolling ? 'border-t mt-4 pt-4' : ''}`}>
            <h4 className="text-sm font-semibold flex items-center gap-1 mb-3">
              <Clock size={16} /> Chronologie des traitements Spark
            </h4>
            <div className="space-y-3 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">

              {project.convert_started_at && (
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full border border-primary/50 bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm">
                    <ArrowsClockwise size={10} className={project.convert_ended_at ? "" : "animate-spin text-primary"} />
                  </div>
                  <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 border rounded text-xs bg-muted/40 transition-colors">
                    <p className="font-semibold text-foreground">Conversion Parquet</p>
                    <div className="flex justify-between text-muted-foreground mt-1">
                      <span>Début : {formatTime(project.convert_started_at)}</span>
                      {project.convert_ended_at && <span>Fin : {formatTime(project.convert_ended_at)}</span>}
                    </div>
                    {project.convert_ended_at && (
                      <div className="mt-1.5 pt-1.5 border-t border-border flex justify-between font-mono text-primary font-medium">
                        <span>Durée</span>
                        <span>{formatDuration(project.convert_started_at, project.convert_ended_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result && result.created_at && (
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full border border-primary/50 bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm">
                    <ChartBar size={10} className={result.ended_at ? "" : "animate-spin text-primary"} />
                  </div>
                  <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 border rounded text-xs bg-muted/40 transition-colors">
                    <p className="font-semibold text-foreground">Analyse des données</p>
                    <div className="flex justify-between text-muted-foreground mt-1">
                      <span>Début : {formatTime(result.created_at)}</span>
                      {result.ended_at && <span>Fin : {formatTime(result.ended_at)}</span>}
                    </div>
                    {result.ended_at && (
                      <div className="mt-1.5 pt-1.5 border-t border-border flex justify-between font-mono text-primary font-medium">
                        <span>Durée</span>
                        <span>{formatDuration(result.created_at, result.ended_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Storage Efficiency Card */}
      {(() => {
        const stats = computeCompressionStats(project.csv_size_bytes, project.parquet_size_bytes);
        if (!stats) return null;
        const parquetW = Math.max(3, Math.round(stats.compressionRatio * 100));
        return (
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              {/* Always-visible: bars + headline stat */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
                  Storage Efficiency
                </p>
                <span className="text-[10px] font-semibold text-emerald-600 tabular-nums">
                  −{stats.sizeReductionPct}%
                </span>
              </div>

              {/* Bar — CSV */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">CSV</span>
                  <span className="font-mono tabular-nums">{formatBytes(project.csv_size_bytes)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-full rounded-full bg-muted-foreground/30" />
                </div>
              </div>

              {/* Bar — Parquet */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-foreground font-medium">Parquet</span>
                  <span className="font-mono tabular-nums text-foreground font-medium">{formatBytes(project.parquet_size_bytes)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${parquetW}%` }}
                  />
                </div>
              </div>

              {/* Collapsible details */}
              <details className="group">
                <summary className="flex items-center gap-1 cursor-pointer select-none list-none pt-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
                  <Database size={12} className="shrink-0" />
                  <span className="group-open:hidden">Voir les métriques détaillées</span>
                  <span className="hidden group-open:inline">Masquer</span>
                </summary>

                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {/* KPI row */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Size reduction</span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{stats.sizeReductionPct}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Compression ratio</span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{stats.compressionRatio.toFixed(2)}×</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Space saved</span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{formatBytes(stats.savedBytes)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        Spark read speedup
                      </span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{stats.sparkReadSpeedup}×</span>
                    </div>
                  </div>

                  {/* One-liner explainer */}
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Parquet (columnar + Snappy) permet à Spark d&apos;appliquer column pruning et predicate pushdown,
                    réduisant les I/O versus un scan CSV ligne par ligne.
                  </p>
                </div>
              </details>
            </CardContent>
          </Card>
        );
      })()}

      {/* Uploaded — waiting */}
      {project.status === "uploaded" && (
        <Card>
          <CardContent className="py-8 text-center">
            <Clock size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Le fichier a été uploadé. La conversion démarrera sous peu.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Ready — column selection */}
      {project.status === "ready" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ChartBar size={18} />
              Sélection des colonnes à analyser
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                    id="select-all"
                    checked={selectedColumns.size === columns.filter(c => isNumericType(c.type)).length && selectedColumns.size > 0}
                    onCheckedChange={toggleAll}
                  />
                  <label htmlFor="select-all" className="text-xs font-medium text-foreground cursor-pointer">
                    Tout sélectionner (numériques uniquement)
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {columns.map((col) => {
                    const isNum = isNumericType(col.type);
                    return (
                      <div key={col.name} className={`flex items-center justify-between py-1 px-2 rounded transition-colors ${isNum ? 'hover:bg-muted/50 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Checkbox
                            id={`col-${col.name}`}
                            checked={selectedColumns.has(col.name)}
                            onCheckedChange={() => isNum && toggleColumn(col.name)}
                            disabled={!isNum}
                          />
                          <label htmlFor={`col-${col.name}`} className={`text-sm truncate ${isNum ? 'text-foreground cursor-pointer' : 'text-muted-foreground cursor-not-allowed'}`} title={!isNum ? "Seules les colonnes numériques peuvent être analysées (moyenne)." : ""}>
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

                {/* Data Preview */}
                {preview && preview.length > 0 && (
                  <div className="mt-6 border rounded-md overflow-hidden">
                    <div className="bg-muted px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
                      <span>Aperçu des données ({preview.length} premières lignes)</span>
                    </div>
                    <div className="overflow-x-auto max-h-[300px]">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-background sticky top-0 border-b shadow-sm z-10">
                          <tr>
                            {columns.map((col) => (
                              <th key={`th-${col.name}`} className="py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">
                                {col.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((row, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                              {columns.map((col) => (
                                <td key={`td-${i}-${col.name}`} className="py-1.5 px-3 max-w-[150px] truncate" title={String(row[col.name] ?? "")}>
                                  {row[col.name] !== null && row[col.name] !== undefined ? String(row[col.name]) : <span className="text-muted-foreground italic">null</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {analysisError && (
              <p className="text-sm text-destructive">{analysisError}</p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleLaunchAnalysis}
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
          </CardContent>
        </Card>
      )}

      {/* Completed — results */}
      {project.status === "completed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600" />
              Résultats de l&apos;analyse
            </CardTitle>
          </CardHeader>
          <CardContent>
            {resultLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : result && Object.keys(result.result).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-foreground">Colonne</th>
                      <th className="text-right py-2 px-3 font-medium text-foreground">Moyenne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.result).map(([key, value]) => (
                      <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3 text-foreground font-mono">{key}</td>
                        <td className="py-2 px-3 text-right text-foreground tabular-nums">
                          {typeof value === "number" ? value.toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : String(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucun résultat disponible.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Failed */}
      {project.status === "failed" && (
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle size={32} className="mx-auto text-destructive mb-3" />
            <p className="text-sm text-destructive">
              Le traitement a échoué.
            </p>
            {progress?.message && (
              <p className="text-xs text-muted-foreground mt-2">{progress.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
