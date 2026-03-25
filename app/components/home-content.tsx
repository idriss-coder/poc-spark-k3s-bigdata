"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listProjects, formatBytes, type ProjectListItem } from "@/app/lib/api";
import { UploadForm } from "@/components/upload-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight } from "@phosphor-icons/react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  uploaded: { label: "Uploadé", variant: "secondary" },
  converting: { label: "Conversion", variant: "default" },
  ready: { label: "Prêt", variant: "outline" },
  analysing: { label: "Analyse", variant: "default" },
  completed: { label: "Terminé", variant: "outline" },
  failed: { label: "Échoué", variant: "destructive" },
};

function formatDate(iso: string) {
  try {
    const dateStr = iso.endsWith('Z') ? iso : iso + 'Z';
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function HomeContent() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      const data = await listProjects();
      setProjects(data);
      return data;
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Impossible de charger les projets.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling: refresh list every 5s if any project is in converting or analysing
  useEffect(() => {
    refresh().then((data) => {
      const hasActive = data.some((p) => p.status === "converting" || p.status === "analysing");
      if (hasActive && !pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          const updated = await refresh();
          const stillActive = updated.some((p) => p.status === "converting" || p.status === "analysing");
          if (!stillActive && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }, 5000);
      }
    });
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [refresh]);

  const handleUploadSuccess = () => {
    refresh().then((data) => {
      // Start polling if new project is converting
      const hasActive = data.some((p) => p.status === "converting" || p.status === "analysing");
      if (hasActive && !pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          const updated = await refresh();
          const stillActive = updated.some((p) => p.status === "converting" || p.status === "analysing");
          if (!stillActive && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }, 5000);
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <header className="border-b border-border pb-4">
        <h1 className="text-xl font-bold text-foreground">
          POC Analyse CSV
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Créez un projet depuis un CSV à convertir ou réutilisez un Parquet déjà disponible pour aller directement à l&apos;analyse.
        </p>
      </header>

      {/* Upload section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nouveau projet</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadForm onSuccess={handleUploadSuccess} />
        </CardContent>
      </Card>

      {/* Projects list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Projets</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : listError ? (
            <p className="text-sm text-destructive">{listError}</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun projet pour l&apos;instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-foreground">Nom</th>
                    <th className="text-left py-2 px-3 font-medium text-foreground">Statut</th>
                    <th className="text-left py-2 px-3 font-medium text-foreground">Taille (CSV → Parquet)</th>
                    <th className="text-left py-2 px-3 font-medium text-foreground">Créé le</th>
                    <th className="py-2 px-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const cfg = STATUS_CONFIG[p.status] ?? { label: p.status, variant: "secondary" as const };
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
                        <td className="py-2 px-3">
                          <Link
                            href={`/projects/${p.id}`}
                            className="text-foreground hover:text-primary transition-colors font-medium"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={cfg.variant} className="text-xs">
                            {cfg.label}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap text-xs">
                          {p.csv_size_bytes ? formatBytes(p.csv_size_bytes) : "-"}
                          {p.parquet_size_bytes ? (
                            <>
                              {" "}→ <span className="text-primary font-medium">{formatBytes(p.parquet_size_bytes)}</span>
                            </>
                          ) : ""}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {formatDate(p.created_at)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Link
                            href={`/projects/${p.id}`}
                            className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <ArrowRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
