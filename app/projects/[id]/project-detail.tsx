"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getProject,
  getProjectColumns,
  getProgress,
  getResult,
  getAtRiskDetails,
  prepareAtRiskDetailsDownload,
  launchAnalysis,
  deleteProject,
  formatBytes,
  computeCompressionStats,
  type ProjectDetail,
  type ProgressResponse,
  type ResultResponse,
  type AtRiskDetailsResponse,
  type ColumnInfo,
  type DataSchemaEntry,
  type AnalysisType,
} from "@/app/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ChartBar,
  Lightning,
  Spinner,
  CheckCircle,
  XCircle,
  Clock,
  ArrowsClockwise,
  Trash,
  Database,
  ShieldWarning,
  ArrowRight,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { DataSchemaConfig } from "@/components/analysis/data-schema-config";
import { FearedEventsConfig } from "@/components/analysis/feared-events-config";
import { AnalysisTypeConfig } from "@/components/analysis/analysis-type-config";
import { CircularProgress } from "@/components/ui/circular-progress";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }
> = {
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
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function formatDate(iso: string) {
  try {
    return parseUtcDate(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function formatTime(iso: string) {
  try {
    return parseUtcDate(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function formatDuration(startISO: string, endISO: string): string {
  try {
    const start = parseUtcDate(startISO).getTime();
    const end = parseUtcDate(endISO).getTime();
    if (isNaN(start) || isNaN(end)) return "";
    const diff_seconds = Math.max(0, Math.floor((end - start) / 1000));
    if (diff_seconds < 60) return `${diff_seconds}s`;
    const minutes = Math.floor(diff_seconds / 60);
    const seconds = diff_seconds % 60;
    return `${minutes}m ${seconds}s`;
  } catch { return ""; }
}

function getProgressPhaseLabel(progress: ProgressResponse | null, projectStatus: string) {
  const isConvert = progress?.step === "convert" || projectStatus === "converting";

  switch (progress?.phase) {
    case "queued":
      return isConvert ? "Conversion en file d'attente" : "Analyse en file d'attente";
    case "submitting":
      return "Soumission du job Spark";
    case "driver_pending":
      return "Driver Spark en attente";
    case "running":
      return isConvert ? "Conversion CSV → Parquet" : "Exécution Spark distribuée";
    case "finalizing":
      return isConvert ? "Finalisation de la conversion" : "Finalisation de l'analyse";
    case "failed":
      return isConvert ? "Conversion en échec" : "Analyse en échec";
    case "completed":
      return isConvert ? "Conversion terminée" : "Analyse terminée";
    default:
      return isConvert ? "Conversion Spark" : "Analyse Spark";
  }
}

function getDisplayedProgress(progress: ProgressResponse | null) {
  if (!progress) return 0;
  if (progress.phase === "finalizing") {
    return progress.progress > 0 ? progress.progress : 99;
  }
  if (!progress.is_real_progress) {
    return 0;
  }
  return progress.progress;
}

const AT_RISK_LOADING_MESSAGES = [
  { afterMs: 0, label: "Ouverture de la connexion aux détails at risk..." },
  { afterMs: 2000, label: "Lecture des personnes at risk..." },
  { afterMs: 4500, label: "Streaming des détails depuis S3..." },
  { afterMs: 8000, label: "Préparation de l'affichage..." },
] as const;

function getAtRiskLoadingMessage(elapsedMs: number) {
  let message = AT_RISK_LOADING_MESSAGES[0].label;

  AT_RISK_LOADING_MESSAGES.forEach((step) => {
    if (elapsedMs >= step.afterMs) {
      message = step.label as typeof message;
    }
  });

  return message;
}

// ---------------------------------------------------------------------------
// Build default schema entries from columns
// ---------------------------------------------------------------------------
function buildDefaultSchema(columns: ColumnInfo[]): DataSchemaEntry[] {
  return columns.map((col) => ({
    name: col.name,
    exhibition: "restricted_internal",
    use_in_analysis: false,
  }));
}

// ---------------------------------------------------------------------------
// Stepper indicator
// ---------------------------------------------------------------------------
const STEPS = [
  { id: 1, label: "Colonnes & exposition" },
  { id: 2, label: "Événements redoutés" },
  { id: 3, label: "Type d'analyse" },
];

type AnalysisSingleRow = {
  variable: string;
  individualization?: number;
  inference?: number;
  correlation?: number;
  exploitability?: number;
  at_risk?: AtRiskSummary | null;
};

type AnalysisPreviewSection = {
  sensibleVariable: string;
  rows: AnalysisSingleRow[];
};

type AnalysisCombinedRow = {
  scope: string;
  variables: string[];
  individualization?: number;
  inference?: number;
  correlation?: number;
  exploitability?: number;
  at_risk?: AtRiskSummary | null;
};

type AnalysisCombinedSection = {
  sensibleVariable: string;
  rows: AnalysisCombinedRow[];
};

type AtRiskSummary = {
  total?: number;
  artifact_id?: number;
  artifact_key?: string;
  details_path?: string;
  detail_row_count?: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractAtRiskSummary(value: unknown): AtRiskSummary | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  return {
    total: parseOptionalNumber(value.total),
    artifact_id: parseOptionalNumber(value.artifact_id),
    artifact_key: parseOptionalString(value.artifact_key),
    details_path: parseOptionalString(value.details_path),
    detail_row_count: parseOptionalNumber(value.detail_row_count),
  };
}

function hasAtRiskDetails(summary: AtRiskSummary | null | undefined) {
  if (!summary) {
    return false;
  }

  return (
    summary.artifact_id != null
    || summary.artifact_key != null
    || summary.details_path != null
    || summary.detail_row_count != null
  );
}

function extractAnalysisPreviewSections(preview: unknown[]): AnalysisPreviewSection[] {
  return preview.flatMap((entry, index) => {
    if (!isObjectRecord(entry)) return [];

    const evaluations = isObjectRecord(entry.evaluations) ? entry.evaluations : null;
    const single = Array.isArray(evaluations?.single) ? evaluations.single : [];
    const rows = single.filter(isObjectRecord).map((row) => ({
      variable: typeof row.variable === "string" ? row.variable : "—",
      individualization: parseOptionalNumber(row.individualization),
      inference: parseOptionalNumber(row.inference),
      correlation: parseOptionalNumber(row.correlation),
      exploitability: parseOptionalNumber(row.exploitability),
      at_risk: extractAtRiskSummary(row.at_risk),
    }));

    if (rows.length === 0) return [];

    return [
      {
        sensibleVariable:
          typeof entry.sensible_variable === "string"
            ? entry.sensible_variable
            : `Variable sensible ${index + 1}`,
        rows,
      },
    ];
  });
}

function getCombinedScopeLabel(scope: string) {
  switch (scope) {
    case "extended_externals":
      return "Externes étendues";
    case "restricted_externals":
      return "Externes restreintes";
    case "extended_internals":
      return "Internes étendues";
    case "restricted_internals":
      return "Internes restreintes";
    default:
      return scope;
  }
}

function formatAtRiskValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildAtRiskPagination(currentPage: number, totalPages: number) {
  const safeTotalPages = Math.max(totalPages, 1);
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), safeTotalPages);
  const pages = new Set<number>();

  for (let page = 1; page <= Math.min(3, safeTotalPages); page += 1) {
    pages.add(page);
  }

  pages.add(safeCurrentPage);
  pages.add(safeTotalPages);

  const sortedPages = Array.from(pages).sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];
  let previousPage: number | null = null;

  sortedPages.forEach((page) => {
    if (previousPage != null) {
      const gap = page - previousPage;
      if (gap === 2) {
        items.push(previousPage + 1);
      } else if (gap > 2) {
        items.push("ellipsis");
      }
    }

    items.push(page);
    previousPage = page;
  });

  return items;
}

function extractCombinedAnalysisPreviewSections(preview: unknown[]): AnalysisCombinedSection[] {
  const combinedScopes = [
    "extended_externals",
    "restricted_externals",
    "extended_internals",
    "restricted_internals",
  ] as const;

  return preview.flatMap((entry, index) => {
    if (!isObjectRecord(entry)) return [];

    const evaluations = isObjectRecord(entry.evaluations) ? entry.evaluations : null;
    if (!evaluations) return [];

    const rows = combinedScopes.flatMap((scope) => {
      const rawScope = evaluations[scope];
      if (!isObjectRecord(rawScope)) return [];

      const variables = Array.isArray(rawScope.variable)
        ? rawScope.variable.filter((value): value is string => typeof value === "string")
        : [];

      if (variables.length === 0) return [];

      return [{
        scope: getCombinedScopeLabel(scope),
        variables,
        individualization: parseOptionalNumber(rawScope.individualization),
        inference: parseOptionalNumber(rawScope.inference),
        correlation: parseOptionalNumber(rawScope.correlation),
        exploitability: parseOptionalNumber(rawScope.exploitability),
        at_risk: extractAtRiskSummary(rawScope.at_risk),
      }];
    });

    if (rows.length === 0) return [];

    return [
      {
        sensibleVariable:
          typeof entry.sensible_variable === "string"
            ? entry.sensible_variable
            : `Variable sensible ${index + 1}`,
        rows,
      },
    ];
  });
}

function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Étapes de configuration" className="flex items-center gap-1 flex-wrap">
      {STEPS.map((step, idx) => {
        const state = step.id < current ? "done" : step.id === current ? "active" : "pending";
        return (
          <div key={step.id} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-xs px-3 py-1 text-xs font-medium transition-colors ${state === "done"
                ? "bg-primary/15 text-primary"
                : state === "active"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground"
                }`}
            >
              {state === "done" ? (
                <CheckCircle size={12} />
              ) : (
                <span className="w-4 text-center">{step.id}</span>
              )}
              {step.label}
            </div>
            {idx < STEPS.length - 1 && (
              <ArrowRight size={12} className="text-muted-foreground/50 shrink-0" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectDetailContent({ projectId }: { projectId: number }) {
  // --- Project ---
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Columns ---
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);

  // --- Analysis ---
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // --- Progress & result ---
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [resultLoading, setResultLoading] = useState(false);

  // --- Delete ---
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Vulnerability config state (Tab 1) ---
  const [schema, setSchema] = useState<DataSchemaEntry[]>([]);
  const [fearedCols, setFearedCols] = useState<Set<string>>(new Set());
  const [analysisType, setAnalysisType] = useState<AnalysisType>("transversal");
  const [longitudinalCol, setLongitudinalCol] = useState<string | null>(null);
  const [vulnStep, setVulnStep] = useState<1 | 2 | 3 | "done">(1);
  const [atRiskDialogOpen, setAtRiskDialogOpen] = useState(false);
  const [atRiskDialogTitle, setAtRiskDialogTitle] = useState("");
  const [atRiskDialogSubtitle, setAtRiskDialogSubtitle] = useState("");
  const [selectedAtRiskArtifactId, setSelectedAtRiskArtifactId] = useState<number | null>(null);
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [atRiskLoading, setAtRiskLoading] = useState(false);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);
  const [atRiskDetails, setAtRiskDetails] = useState<AtRiskDetailsResponse | null>(null);
  const [atRiskLoadingElapsedMs, setAtRiskLoadingElapsedMs] = useState(0);
  const [atRiskDownloadLoading, setAtRiskDownloadLoading] = useState(false);
  const [atRiskDownloadError, setAtRiskDownloadError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch helpers
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

  const fetchColumns = useCallback(async () => {
    setColumnsLoading(true);
    try {
      const res = await getProjectColumns(projectId);
      setColumns(res.columns);
      setPreview((res.preview ?? []) as Record<string, unknown>[]);
      setSchema(buildDefaultSchema(res.columns));
    } catch {
      setColumns([]);
      setPreview([]);
    } finally {
      setColumnsLoading(false);
    }
  }, [projectId]);

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
        const p = await getProject(projectId);
        setProject(p);
        if (p.status === "ready") {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          fetchColumns();
        } else if (p.status === "completed") {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          fetchResult();
        } else if (p.status === "failed") {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }
      } catch { /* silently retry */ }
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

  useEffect(() => {
    if (!atRiskLoading) {
      setAtRiskLoadingElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    const updateElapsed = () => {
      setAtRiskLoadingElapsedMs(Date.now() - startedAt);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [atRiskLoading, atRiskPage, selectedAtRiskArtifactId]);

  useEffect(() => {
    if (!atRiskDialogOpen || selectedAtRiskArtifactId == null) return;

    let cancelled = false;

    (async () => {
      setAtRiskLoading(true);
      setAtRiskError(null);
      try {
        const data = await getAtRiskDetails(projectId, selectedAtRiskArtifactId, atRiskPage, 20);
        if (!cancelled) {
          setAtRiskDetails(data);
        }
      } catch (err) {
        if (!cancelled) {
          setAtRiskDetails(null);
          setAtRiskError(err instanceof Error ? err.message : "Impossible de charger les personnes at risk.");
        }
      } finally {
        if (!cancelled) {
          setAtRiskLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [atRiskDialogOpen, atRiskPage, projectId, selectedAtRiskArtifactId]);

  // -------------------------------------------------------------------------
  // DR Vulnerability analysis submission
  // -------------------------------------------------------------------------
  const handleVulnAnalyse = async () => {
    const types = { sensible: [] as string[], ee: [] as string[], er: [] as string[], ie: [] as string[], ir: [] as string[] };
    
    schema.forEach(col => {
      if (!col.use_in_analysis) return;

      switch (col.exhibition) {
        case "extended_internal":
          types.ie.push(col.name);
          break;
        case "restricted_internal":
          types.ir.push(col.name);
          break;
        case "extended_external":
          types.ee.push(col.name);
          break;
        case "restricted_external":
          types.er.push(col.name);
          break;
        default:
          types.sensible.push(col.name);
      }

      if (fearedCols.has(col.name)) {
        if (!types.sensible.includes(col.name)) {
          types.sensible.push(col.name);
        }
      }
    });

    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      await launchAnalysis(projectId, {
        types,
        analysis_type: analysisType,
        longitudinal_column: analysisType === "longitudinal" ? longitudinalCol : null,
      });
      const p = await fetchProject();
      if (p && p.status === "analysing") {
        setProgress({
          status: "analysing",
          progress: 0,
          message: "Analyse en file d'attente",
          step: "analyse",
          phase: "queued",
          progress_source: "system",
          is_real_progress: false,
        });
        startPolling();
      }
      setVulnStep("done");
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Erreur lors du lancement.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleAnalysisTypeChange = (type: AnalysisType, col: string | null) => {
    setAnalysisType(type);
    setLongitudinalCol(col);
  };

  const openAtRiskDialog = (
    atRisk: AtRiskSummary,
    title: string,
    subtitle: string,
  ) => {
    setAtRiskDialogTitle(title);
    setAtRiskDialogSubtitle(subtitle);
    setAtRiskPage(1);
    setAtRiskDetails(null);
    setAtRiskLoading(false);
    setAtRiskLoadingElapsedMs(0);
    setAtRiskDownloadLoading(false);
    setAtRiskDownloadError(null);

    if (atRisk.artifact_id == null) {
      setSelectedAtRiskArtifactId(null);
      setAtRiskError(
        "Les métadonnées at risk sont bien présentes, mais cette réponse ne contient pas `artifact_id`, qui est requis par la route de détails paginés."
      );
      setAtRiskDialogOpen(true);
      return;
    }

    setSelectedAtRiskArtifactId(atRisk.artifact_id);
    setAtRiskError(null);
    setAtRiskDialogOpen(true);
  };

  const closeAtRiskDialog = () => {
    setAtRiskDialogOpen(false);
    setSelectedAtRiskArtifactId(null);
    setAtRiskDetails(null);
    setAtRiskError(null);
    setAtRiskLoading(false);
    setAtRiskLoadingElapsedMs(0);
    setAtRiskDownloadLoading(false);
    setAtRiskDownloadError(null);
  };

  const handleAtRiskDownload = async () => {
    if (selectedAtRiskArtifactId == null) {
      return;
    }

    setAtRiskDownloadLoading(true);
    setAtRiskDownloadError(null);

    try {
      const { download_url } = await prepareAtRiskDetailsDownload(projectId, selectedAtRiskArtifactId);
      const link = document.createElement("a");
      link.href = download_url;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setAtRiskDownloadError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer le lien de téléchargement du fichier complet.",
      );
    } finally {
      setAtRiskDownloadLoading(false);
    }
  };

  const eligibleColumns = schema.filter((e) => e.use_in_analysis);
  const analysisPreviewSections = result ? extractAnalysisPreviewSections(result.preview) : [];
  const combinedAnalysisPreviewSections = result ? extractCombinedAnalysisPreviewSections(result.preview) : [];
  const displayedProgress = getDisplayedProgress(progress);
  const atRiskTotalPages = Math.max(atRiskDetails?.total_pages ?? 0, 1);
  const atRiskPaginationItems = buildAtRiskPagination(atRiskPage, atRiskTotalPages);
  const atRiskLoadingMessage = getAtRiskLoadingMessage(atRiskLoadingElapsedMs);

  // -------------------------------------------------------------------------
  // Can proceed checks
  // -------------------------------------------------------------------------
  const canGoStep2 = eligibleColumns.length > 0;
  const canGoStep3 = true; // step 2 is optional (0 feared events allowed)
  const canAnalyse =
    analysisType === "transversal" ||
    (analysisType === "longitudinal" && longitudinalCol !== null);

  // -------------------------------------------------------------------------
  // Delete
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
  // Render — loading / error
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
  const isParquetOnlyProject = !project.csv_s3_path && !!project.parquet_s3_path;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={16} /> Projets
      </Link>

      {/* ------------------------------------------------------------------ */}
      {/* Project header card                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {project.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Créé le {formatDate(project.created_at)} — ID {project.id}
            </p>
            {(project.csv_size_bytes != null || project.parquet_size_bytes != null) && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {project.csv_size_bytes != null && (
                  <span>CSV: {formatBytes(project.csv_size_bytes)}</span>
                )}
                {project.parquet_size_bytes != null && (
                  <span className={project.csv_size_bytes != null ? "text-primary font-medium ml-2 border-l border-border pl-2" : "text-primary font-medium"}>
                    Parquet: {formatBytes(project.parquet_size_bytes)}
                  </span>
                )}
                {project.total_rows != null && (
                  <span className="text-primary font-medium ml-2 border-l border-border pl-2" title="Lignes extraites depuis le fichier Parquet">
                    Lignes: {project.total_rows.toLocaleString("fr-FR")}
                  </span>
                )}
              </p>
            )}
            {isParquetOnlyProject && (
              <p className="text-xs text-muted-foreground">
                Source: fichier Parquet existant
                {project.source_project_id != null && (
                  <span className="ml-1">
                    depuis le projet{" "}
                    <Link href={`/projects/${project.source_project_id}`} className="text-primary hover:underline">
                      #{project.source_project_id}
                    </Link>
                  </span>
                )}
              </p>
            )}
            {project.csv_s3_path && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                CSV: {project.csv_s3_path}
              </p>
            )}
            {project.parquet_s3_path && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Parquet: {project.parquet_s3_path}
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

        {/* Progress bar */}
        {isPolling ? (
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {getProgressPhaseLabel(progress, project.status)}
                </span>
                {displayedProgress && displayedProgress > 0 ?<span>{displayedProgress}%</span> : <span/>}
              </div>
              {displayedProgress && displayedProgress > 0 ? (
                <Progress value={displayedProgress} className="h-2" />
              ) : <CircularProgress size={24} className="mx-auto text-primary" />}
              {progress?.message && (
                <p className="text-xs text-muted-foreground">{progress.message}</p>
              )}
            </div>
          </CardContent>
        ) : <span />}
        {/* Execution timeline */}
        {(project.convert_ended_at || project.convert_started_at || (result && result.ended_at)) && (
          <CardContent className={`pt-0 ${isPolling ? "border-t mt-4 pt-4" : ""}`}>
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

      {/* ------------------------------------------------------------------ */}
      {/* Storage efficiency card                                              */}
      {/* ------------------------------------------------------------------ */}
      {(() => {
        const stats = computeCompressionStats(project.csv_size_bytes, project.parquet_size_bytes);
        if (!stats) return null;
        const parquetW = Math.max(3, Math.round(stats.compressionRatio * 100));
        return (
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground tracking-wide uppercase">Storage Efficiency</p>
                <span className="text-[10px] font-semibold text-emerald-600 tabular-nums">−{stats.sizeReductionPct}%</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">CSV</span>
                  <span className="font-mono tabular-nums">{formatBytes(project.csv_size_bytes)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-full rounded-full bg-muted-foreground/30" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-foreground font-medium">Parquet</span>
                  <span className="font-mono tabular-nums text-foreground font-medium">{formatBytes(project.parquet_size_bytes)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${parquetW}%` }} />
                </div>
              </div>
              <details className="group">
                <summary className="flex items-center gap-1 cursor-pointer select-none list-none pt-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
                  <Database size={12} className="shrink-0" />
                  <span className="group-open:hidden">Voir les métriques détaillées</span>
                  <span className="hidden group-open:inline">Masquer</span>
                </summary>
                <div className="mt-3 space-y-3 border-t border-border pt-3">
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
                      <span className="text-xs text-muted-foreground flex items-center gap-1">Spark read speedup</span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">{stats.sparkReadSpeedup}×</span>
                    </div>
                  </div>
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

      {/* ------------------------------------------------------------------ */}
      {/* Uploaded — waiting                                                   */}
      {/* ------------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------------ */}
      {/* Ready — two tabs                                                     */}
      {/* ------------------------------------------------------------------ */}
      {project.status === "ready" && (
        <>
          {/* Data Preview — always visible above tabs */}
          {!columnsLoading && preview.length > 0 && (
            <Card>
              <CardContent className=" overflow-hidden">
                <div className="bg-muted px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
                  <span>Aperçu des données ({preview.length} premières lignes)</span>
                </div>
                <div className="overflow-x-auto max-h-[280px]">
                  <table className="w-full text-xs text-left border-collapse rounded-md">
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
                              {row[col.name] !== null && row[col.name] !== undefined
                                ? String(row[col.name])
                                : <span className="text-muted-foreground italic">null</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4 pt-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldWarning size={18} className="text-primary" />
                    Configuration de l&apos;analyse de vulnérabilité DR
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-6">
                  {analysisError && (
                    <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm mb-4">
                      {analysisError}
                    </div>
                  )}
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
                      {/* Stepper */}
                      {vulnStep !== "done" && <Stepper current={vulnStep} />}

                      {/* STEP 1 */}
                      {vulnStep === 1 && (
                        <div className="space-y-4">
                          <DataSchemaConfig
                            columns={columns}
                            schema={schema}
                            onChange={setSchema}
                          />
                          <div className="flex justify-end pt-2">
                            <Button
                              onClick={() => setVulnStep(2)}
                              disabled={!canGoStep2}
                              size="sm"
                              className="gap-1.5"
                            >
                              Suivant
                              <ArrowRight size={14} />
                            </Button>
                          </div>
                          {!canGoStep2 && (
                            <p className="text-xs text-muted-foreground text-right">
                              Sélectionnez au moins une colonne pour continuer.
                            </p>
                          )}
                        </div>
                      )}

                      {/* STEP 2 */}
                      {vulnStep === 2 && (
                        <div className="space-y-4">
                          <FearedEventsConfig
                            eligibleColumns={eligibleColumns}
                            selectedIds={fearedCols}
                            onChange={setFearedCols}
                          />
                          <div className="flex justify-between pt-2">
                            <Button variant="outline" size="sm" onClick={() => setVulnStep(1)}>
                              Retour
                            </Button>
                            <Button
                              onClick={() => setVulnStep(3)}
                              disabled={!canGoStep3}
                              size="sm"
                              className="gap-1.5"
                            >
                              Suivant
                              <ArrowRight size={14} />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* STEP 3 */}
                      {vulnStep === 3 && (
                        <div className="space-y-4">
                          <AnalysisTypeConfig
                            analysisType={analysisType}
                            longitudinalColumn={longitudinalCol}
                            columns={eligibleColumns}
                            onChange={handleAnalysisTypeChange}
                          />
                          <div className="flex justify-between pt-2">
                            <Button variant="outline" size="sm" onClick={() => setVulnStep(2)}>
                              Retour
                            </Button>
                            <Button
                              onClick={handleVulnAnalyse}
                              disabled={!canAnalyse || analysisLoading}
                              size="sm"
                              className="gap-1.5"
                            >
                              {analysisLoading ? <Spinner size={14} className="animate-spin" /> : <Lightning size={14} />}
                              {analysisLoading ? "Lancement..." : "Analyser"}
                            </Button>
                          </div>
                          {!canAnalyse && (
                            <p className="text-xs text-muted-foreground text-right">
                              Veuillez sélectionner une colonne temporelle pour l&apos;analyse longitudinale.
                            </p>
                          )}
                        </div>
                      )}

                      {/* DONE — En cours d'analyse */}
                      {vulnStep === "done" && (
                        <div className="space-y-4 text-center py-6">
                           <ShieldWarning size={48} className="mx-auto text-primary/40 mb-2" />
                           <h3 className="font-semibold text-lg">Analyse DR en file d&apos;attente</h3>
                           <p className="text-sm text-muted-foreground">La configuration a été transmise à Spark. Vous pouvez suivre la progression en haut de la page.</p>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Completed — results (kept for when user returns to completed state)  */}
      {/* ------------------------------------------------------------------ */}
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
            ) : result ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {result.result_format && (
                    <Badge variant="outline" className="font-mono">
                      {result.result_format.toUpperCase()}
                    </Badge>
                  )}
                  {result.result_row_count != null && (
                    <span>{result.result_row_count.toLocaleString("fr-FR")} ligne(s) de résultat</span>
                  )}
                  {result.result_s3_path && (
                    <span className="font-mono break-all">{result.result_s3_path}</span>
                  )}
                </div>

                {analysisPreviewSections.length > 0 || combinedAnalysisPreviewSections.length > 0 ? (
                  <div className="space-y-4">
                    {analysisPreviewSections.map((section) => (
                      <div key={`single-${section.sensibleVariable}`} className="overflow-hidden rounded-md border border-border bg-muted/20">
                        <div className="px-4 py-3 border-b border-border text-sm font-medium">
                          Variable sensible: <span className="font-mono">{section.sensibleVariable}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead className="bg-muted/40">
                              <tr className="border-b border-border">
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Variable</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Individualization</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Inference</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Correlation</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Exploitability</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">At risk</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.rows.map((row) => (
                                <tr key={`${section.sensibleVariable}-${row.variable}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                                  <td className="py-2.5 px-3 font-mono">{row.variable}</td>
                                  <td className="py-2.5 px-3">{row.individualization ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.inference ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.correlation ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.exploitability ?? "—"}</td>
                                  <td className="py-2.5 px-3">
                                    {hasAtRiskDetails(row.at_risk) ? (
                                      <button
                                        type="button"
                                        className="font-medium text-primary hover:underline underline-offset-4"
                                        onClick={() => openAtRiskDialog(
                                          row.at_risk!,
                                          `Personnes at risk - ${section.sensibleVariable}`,
                                          `Variable: ${row.variable}`,
                                        )}
                                      >
                                        {row?.at_risk?.total?.toLocaleString("fr-FR") ?? "0"}
                                      </button>
                                    ) : (
                                      row.at_risk?.total?.toLocaleString("fr-FR") ?? "0"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}

                    {combinedAnalysisPreviewSections.map((section) => (
                      <div key={`combined-${section.sensibleVariable}`} className="overflow-hidden rounded-md border border-border bg-muted/20">
                        <div className="px-4 py-3 border-b border-border text-sm font-medium">
                          Variables combinées pour: <span className="font-mono">{section.sensibleVariable}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead className="bg-muted/40">
                              <tr className="border-b border-border">
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Portée</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Variables combinées</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Individualization</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Inference</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Correlation</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Exploitability</th>
                                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">At risk</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.rows.map((row) => (
                                <tr key={`${section.sensibleVariable}-${row.scope}-${row.variables.join("-")}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                                  <td className="py-2.5 px-3">{row.scope}</td>
                                  <td className="py-2.5 px-3 font-mono">{row.variables.join(", ")}</td>
                                  <td className="py-2.5 px-3">{row.individualization ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.inference ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.correlation ?? "—"}</td>
                                  <td className="py-2.5 px-3">{row.exploitability ?? "—"}</td>
                                  <td className="py-2.5 px-3">
                                    {hasAtRiskDetails(row.at_risk) ? (
                                      <button
                                        type="button"
                                        className="font-medium text-primary hover:underline underline-offset-4"
                                        onClick={() => openAtRiskDialog(
                                          row.at_risk!,
                                          `Personnes at risk - ${section.sensibleVariable}`,
                                          `${row.scope} - ${row.variables.join(", ")}`,
                                        )}
                                      >
                                        {row?.at_risk?.total?.toLocaleString("fr-FR") ?? "0"}
                                      </button>
                                    ) : (
                                      row.at_risk?.total?.toLocaleString("fr-FR") ?? "0"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : result.preview.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    L&apos;aperçu du résultat est disponible, mais ne contient pas de section exploitable pour l&apos;affichage.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucun aperçu léger disponible pour ce résultat.
                  </p>
                )}

                {result.download_url && (
                  <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                      <a href={result.download_url} target="_blank" rel="noreferrer">
                        Télécharger le résultat complet
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun résultat disponible.</p>
            )}
          </CardContent>
        </Card>
      )}

      {atRiskDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="space-y-1">
                <h3 className="text-base font-semibold">{atRiskDialogTitle}</h3>
                <p className="text-sm text-muted-foreground">{atRiskDialogSubtitle}</p>
                {atRiskDetails && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{atRiskDetails.at_risk_total.toLocaleString("fr-FR")} personne(s) at risk</span>
                    <span>{atRiskDetails.detail_row_count.toLocaleString("fr-FR")} ligne(s) de détail</span>
                    <span>Page {atRiskDetails.page} / {Math.max(atRiskDetails.total_pages, 1)}</span>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={closeAtRiskDialog}>
                Fermer
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {atRiskLoading ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 text-center">
                  <CircularProgress size={34} className="text-primary" />
                  <p className="text-sm text-muted-foreground">{atRiskLoadingMessage}</p>
                </div>
              ) : atRiskError ? (
                <p className="text-sm text-destructive">{atRiskError}</p>
              ) : atRiskDetails && atRiskDetails.items.length > 0 ? (
                <div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm border-collapse">
                      <thead className="bg-muted/40">
                        <tr className="border-b border-border">
                          <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Condition</th>
                          <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Valeur sensible</th>
                          <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Occurrences</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atRiskDetails.items.map((item, index) => (
                          <tr key={`${index}-${formatAtRiskValue(item.condition_value)}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="py-2.5 px-3 font-mono">{formatAtRiskValue(item.condition_value)}</td>
                            <td className="py-2.5 px-3">{formatAtRiskValue(item.sensible_value)}</td>
                            <td className="py-2.5 px-3">{item.count.toLocaleString("fr-FR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucun détail at risk disponible pour cette ligne.
                </p>
              )}
            </div>

            {atRiskDetails && (
              <div className="border-t border-border bg-background px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {atRiskDetails.detail_row_count > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAtRiskDownload}
                        disabled={atRiskDownloadLoading || atRiskLoading}
                      >
                        {atRiskDownloadLoading ? (
                          <>
                            <Spinner size={14} className="animate-spin" />
                            Téléchargement...
                          </>
                        ) : (
                          "Télécharger le fichier complet"
                        )}
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Télécharger le fichier complet
                      </Button>
                    )}
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Pagination par 20 éléments pour éviter les chargements massifs.
                      </p>
                      {atRiskDownloadLoading ? (
                        <p className="text-xs text-muted-foreground">
                          Le téléchargement va démarrer automatiquement dès réception du lien.
                        </p>
                      ) : null}
                      {atRiskDownloadError ? (
                        <p className="text-xs text-destructive">
                          {atRiskDownloadError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {atRiskDetails.total_pages > 0 ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAtRiskPage((page) => Math.max(1, page - 1))}
                        disabled={atRiskLoading || atRiskPage <= 1}
                      >
                        Précédent
                      </Button>

                      <div className="flex flex-wrap items-center gap-2">
                        {atRiskPaginationItems.map((item, index) => {
                          if (item === "ellipsis") {
                            return (
                              <span
                                key={`ellipsis-${index}`}
                                className="px-1 text-xs text-muted-foreground"
                              >
                                ...
                              </span>
                            );
                          }

                          const isActive = item === atRiskPage;

                          return (
                            <Button
                              key={item}
                              variant={isActive ? "default" : "outline"}
                              size="sm"
                              onClick={() => setAtRiskPage(item)}
                              disabled={atRiskLoading || isActive}
                              aria-current={isActive ? "page" : undefined}
                            >
                              {item}
                            </Button>
                          );
                        })}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAtRiskPage((page) => Math.min(atRiskTotalPages, page + 1))}
                        disabled={
                          atRiskLoading
                          || !atRiskDetails
                          || atRiskDetails.total_pages === 0
                          || atRiskPage >= atRiskDetails.total_pages
                        }
                      >
                        Suivant
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Failed                                                               */}
      {/* ------------------------------------------------------------------ */}
      {project.status === "failed" && (
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle size={32} className="mx-auto text-destructive mb-3" />
            <p className="text-sm text-destructive">Le traitement a échoué.</p>
            {progress?.message && (
              <p className="text-xs text-muted-foreground mt-2">{progress.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
