"use client";

import { useRef, useState } from "react";
import {
  startMultipartUpload,
  getMultipartUrls,
  completeMultipartUpload,
  abortMultipartUpload,
  MultipartPart,
} from "@/app/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { UploadSimple, FileCsv, Trash, CircleNotch } from "@phosphor-icons/react";

type UploadFormProps = {
  onSuccess?: () => void;
  className?: string;
};

export function UploadForm({ onSuccess, className }: UploadFormProps) {
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk
  const MAX_CONCURRENCY = 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSuccess(null);
    
    if (!projectName.trim()) {
      setError("Indiquez un nom de projet.");
      submittingRef.current = false;
      return;
    }
    if (!file) {
      setError("Sélectionnez un fichier CSV.");
      submittingRef.current = false;
      return;
    }
    setLoading(true);
    let currentUploadId = "";
    let currentS3Key = "";

    try {
      setUploadPhase("Initialisation de l'envoi...");
      setUploadProgress(0);

      // 1. Start multipart upload
      const startRes = await startMultipartUpload(file.name, "text/csv");
      currentUploadId = startRes.upload_id;
      currentS3Key = startRes.s3_key;

      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

      // 2. Get pre-signed URLs
      setUploadPhase("Génération des autorisations d'upload...");
      const urlsRes = await getMultipartUrls(currentS3Key, currentUploadId, partNumbers);
      const urls = urlsRes.urls;

      setUploadPhase("Envoi des données en cours...");
      
      const uploadedParts: MultipartPart[] = [];
      let partsCompleted = 0;
      let totalBytesUploaded = 0;
      
      // Track progress per part
      const partProgress = new Array(totalParts).fill(0);

      // Helper for uploading a single part
      const uploadPart = async (partNumber: number) => {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const url = urls[partNumber];

        return new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url, true);
          
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              partProgress[partNumber - 1] = event.loaded;
              const currentTotalUploaded = partProgress.reduce((a, b) => a + b, 0);
              const percentComplete = (currentTotalUploaded / file.size) * 100;
              setUploadProgress(percentComplete);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // Extract ETag from response headers.
              // Note: CORS on the S3 bucket must have "ExposeHeaders": ["ETag"]
              let etag = xhr.getResponseHeader("ETag");
              if (!etag) {
                console.warn(`ETag missing for part ${partNumber}`);
                etag = `"fake-etag-for-testing"`; // fallback for local testing without correct CORS
              } else {
                 // Remove extra quotes that some browsers might leave
                etag = etag.replace(/(^"|"$)/g, ""); 
              }
              
              uploadedParts.push({ PartNumber: partNumber, ETag: etag });
              partsCompleted++;
              resolve();
            } else {
              reject(new Error(`Échec de l’envoi de la partie ${partNumber}`));
            }
          };

          xhr.onerror = () => reject(new Error(`Erreur réseau (partie ${partNumber}).`));
          xhr.send(chunk);
        });
      };

      // 3. Upload parts concurrently
      const queue = [...partNumbers];
      const workers = Array(Math.min(MAX_CONCURRENCY, totalParts)).fill(0).map(async () => {
        while (queue.length > 0) {
          const pn = queue.shift();
          if (pn !== undefined) {
             await uploadPart(pn);
          }
        }
      });
      
      await Promise.all(workers);

      // 4. Complete multipart upload
      setUploadPhase("Assemblage du fichier sur le serveur...");
      const completeRes = await completeMultipartUpload(
        currentS3Key,
        currentUploadId,
        uploadedParts,
        projectName.trim(),
        file.size
      );

      setSuccess(`Projet créé (id: ${completeRes.project_id}, statut: ${completeRes.status}).`);
      setProjectName("");
      setFile(null);
      setUploadProgress(100);
      onSuccess?.();
      
    } catch (err) {
      if (currentUploadId && currentS3Key) {
          // Attempt to clean up S3 on failure
          abortMultipartUpload(currentS3Key, currentUploadId).catch(console.error);
      }
      setError(err instanceof Error ? err.message : "Une erreur est survenue lors de l'upload.");
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
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
    } else {
      setError("Veuillez sélectionner un fichier CSV valide.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-6", className)}>
      <div className="space-y-2">
        <label htmlFor="project-name" className="text-sm font-medium text-foreground">
          Nom du projet
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

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Fichier de données
        </label>

        {!file ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "relative group flex flex-col items-center justify-center w-full h-48 px-6 py-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer",
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
          <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
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

      {(error || success) && (
        <div className={cn(
          "p-3 rounded-lg text-sm border",
          error ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-green-500/10 text-green-600 border-green-500/20"
        )}>
          {error || success}
        </div>
      )}

      {loading && (
        <div className="space-y-3 p-4 border rounded-xl bg-muted/40 animate-in fade-in zoom-in-95 duration-200">
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

      <Button
        type="submit"
        disabled={loading || !file || !projectName.trim()}
        className="w-full h-11 text-base shadow-sm"
      >
        {loading ? (
          <>
            <CircleNotch weight="bold" className="w-5 h-5 mr-2 animate-spin" />
            Création du projet...
          </>
        ) : (
          "Créer le projet"
        )}
      </Button>
    </form>
  );
}
