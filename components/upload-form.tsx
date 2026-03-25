"use client";

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { UploadSimple, FileCsv, Trash, CircleNotch, FileArrowDown } from "@phosphor-icons/react";
import { useUpload } from "@/components/upload-provider";
import { formatBytes } from "@/app/lib/api";

type UploadFormProps = {
  onSuccess?: () => void;
  className?: string;
};

export function UploadForm({ onSuccess, className }: UploadFormProps) {
  const {
    creationMode,
    setCreationMode,
    projectName,
    setProjectName,
    file,
    setFile,
    parquetSources,
    parquetSourcesLoading,
    selectedParquetSourceId,
    setSelectedParquetSourceId,
    loading,
    error,
    success,
    uploadProgress,
    uploadPhase,
    startUpload,
    refreshParquetSources,
  } = useUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Trigger onSuccess if the success state appears in the global context
  useEffect(() => {
    if (success && onSuccess) {
      onSuccess();
    }
  }, [success, onSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startUpload();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-6", className)}>
      <Tabs
        value={creationMode}
        onValueChange={(value) => setCreationMode(value as "csv" | "parquet")}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="csv">Upload CSV</TabsTrigger>
          <TabsTrigger value="parquet">Parquet existant</TabsTrigger>
        </TabsList>

        <TabsContent value="csv" className="mt-0">
        </TabsContent>

        <TabsContent value="parquet" className="mt-0 space-y-3">
          <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {parquetSourcesLoading ? "Chargement des sources Parquet..." : `${parquetSources.length} source(s) disponible(s)`}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshParquetSources()} disabled={loading || parquetSourcesLoading}>
              Rafraîchir
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <div className="space-y-3">
        <label htmlFor="project-name" className="text-sm font-medium text-foreground mb-2 inline-block">
          Nom du projet <span className="text-destructive">*</span>
        </label>
        <Input
          id="project-name"
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Ex. analyse-ventes-2024"
          disabled={loading}
          autoComplete="off"
          className="h-11"
        />
      </div>

      {creationMode === "csv" ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground inline-block">
            Fichier de données <span className="text-destructive">*</span>
          </label>

          {!file ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative group flex flex-col items-center justify-center w-full h-48 px-6 py-8 border-2 border-dashed rounded-md transition-all duration-200 cursor-pointer",
                isDragging
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={loading}
                className="hidden"
              />
              <div className="flex flex-col items-center justify-center space-y-4 text-center">
                <div className={cn(
                  "p-4 rounded-full transition-colors duration-200",
                  isDragging ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/5 group-hover:text-primary"
                )}>
                  <UploadSimple weight="duotone" className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Cliquez ou glissez-déposez votre fichier
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fichiers CSV uniquement. Taille max : 200 GO.
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" className="mt-2 relative z-10 pointer-events-none">
                  Parcourir les fichiers
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 border rounded-md bg-card">
              <div className="flex items-center space-x-4 overflow-hidden">
                <div className="p-2.5 bg-primary/10 text-primary rounded-lg shrink-0">
                  <FileCsv weight="duotone" className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setFile(null)}
                disabled={loading}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Supprimer le fichier"
              >
                <Trash weight="duotone" className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground inline-block">
            Source Parquet <span className="text-destructive">*</span>
          </label>
          <Select value={selectedParquetSourceId} onValueChange={setSelectedParquetSourceId} disabled={loading || parquetSourcesLoading || parquetSources.length === 0}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder={parquetSourcesLoading ? "Chargement..." : "Choisir un fichier Parquet déjà disponible"} />
            </SelectTrigger>
            <SelectContent>
              {parquetSources.map((source) => (
                <SelectItem key={source.project_id} value={String(source.project_id)}>
                  {source.project_name} • {source.parquet_size_bytes ? formatBytes(source.parquet_size_bytes) : "taille inconnue"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedParquetSourceId && (
            <div className="flex items-start gap-3 rounded-md border bg-card p-4">
              <div className="p-2.5 bg-primary/10 text-primary rounded-lg shrink-0">
                <FileArrowDown weight="duotone" className="w-6 h-6" />
              </div>
              <div className="min-w-0 space-y-1">
                {(() => {
                  const source = parquetSources.find((item) => String(item.project_id) === selectedParquetSourceId);
                  if (!source) return null;
                  return (
                    <>
                      <p className="text-sm font-medium text-foreground">{source.project_name}</p>
                      <p className="text-xs text-muted-foreground break-all">{source.parquet_s3_path}</p>
                      <p className="text-xs text-muted-foreground">
                        {source.parquet_size_bytes ? formatBytes(source.parquet_size_bytes) : "Taille inconnue"}
                        {source.total_rows != null ? ` • ${source.total_rows.toLocaleString("fr-FR")} lignes` : ""}
                        {` • statut ${source.status}`}
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {!parquetSourcesLoading && parquetSources.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucun projet avec Parquet prêt n&apos;est disponible pour le moment.
            </p>
          )}
        </div>
      )}

      {(error || success) && (
        <div className={cn(
          "p-3 rounded-lg text-sm border",
          error ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-green-500/10 text-green-600 border-green-500/20"
        )}>
          {error || success}
        </div>
      )}

      {loading && (
        <div className="space-y-3 p-4 border rounded-md bg-muted/40 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium text-foreground flex items-center gap-2">
              <CircleNotch weight="bold" className="w-4 h-4 animate-spin text-primary" />
              {uploadPhase}
            </span>
            <span className="text-muted-foreground font-semibold tabular-nums">
              {Math.round(uploadProgress)}%
            </span>
          </div>
          <Progress value={uploadProgress} className="h-2 w-full" />
        </div>
      )}

      <div className="flex items-end justify-end">
        <Button
          type="submit"
          disabled={loading || (creationMode === "parquet" && parquetSources.length === 0)}
          className="rounded w-full cursor-pointer hover:bg-primary/80 h-11 font-semibold text-sm"
        >
          {loading ? (
            <>
              <CircleNotch weight="bold" className="w-5 h-5 mr-2 animate-spin" />
              Création du projet...
            </>
          ) : (
            creationMode === "csv" ? "Créer le projet" : "Créer depuis ce Parquet"
          )}
        </Button>
      </div>
    </form>
  );
}
