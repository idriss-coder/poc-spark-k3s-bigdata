"use client";

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  startMultipartUpload,
  getMultipartUrls,
  completeMultipartUpload,
  abortMultipartUpload,
  MultipartPart,
  createProjectFromParquet,
  listExistingParquetSources,
  type ExistingParquetSource,
} from "@/app/lib/api";

type UploadContextType = {
  creationMode: "csv" | "parquet";
  setCreationMode: (mode: "csv" | "parquet") => void;
  projectName: string;
  setProjectName: (name: string) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  parquetSources: ExistingParquetSource[];
  parquetSourcesLoading: boolean;
  selectedParquetSourceId: string;
  setSelectedParquetSourceId: (value: string) => void;
  loading: boolean;
  error: string | null;
  success: string | null;
  uploadProgress: number;
  uploadPhase: string;
  startUpload: () => Promise<void>;
  refreshParquetSources: () => Promise<void>;
  resetUploadState: () => void;
  setError: (error: string | null) => void;
};

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const CONCURRENCY = 4;

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [creationMode, setCreationMode] = useState<"csv" | "parquet">("csv");
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parquetSources, setParquetSources] = useState<ExistingParquetSource[]>([]);
  const [parquetSourcesLoading, setParquetSourcesLoading] = useState(false);
  const [selectedParquetSourceId, setSelectedParquetSourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");

  const submittingRef = useRef(false);

  const resetUploadState = useCallback(() => {
    setCreationMode("csv");
    setProjectName("");
    setFile(null);
    setSelectedParquetSourceId("");
    setLoading(false);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);
    setUploadPhase("");
  }, []);

  const refreshParquetSources = useCallback(async () => {
    setParquetSourcesLoading(true);
    try {
      const sources = await listExistingParquetSources();
      setParquetSources(sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les fichiers Parquet existants.");
    } finally {
      setParquetSourcesLoading(false);
    }
  }, []);

  const startUpload = async () => {
    if (submittingRef.current) return;
    if (!projectName.trim()) {
      setError("Indiquez un nom de projet.");
      return;
    }
    if (creationMode === "csv" && !file) {
      setError("Sélectionnez un fichier CSV.");
      return;
    }
    if (creationMode === "parquet" && !selectedParquetSourceId) {
      setError("Sélectionnez un fichier Parquet existant.");
      return;
    }

    submittingRef.current = true;
    setError(null);
    setSuccess(null);
    setLoading(true);

    let currentUploadId = "";
    let currentS3Key = "";

    try {
      if (creationMode === "parquet") {
        setUploadPhase("Création du projet à partir du Parquet existant...");
        setUploadProgress(25);
        const completeRes = await createProjectFromParquet(Number(selectedParquetSourceId), projectName.trim());
        setUploadProgress(100);
        setSuccess(`Projet créé (id: ${completeRes.project_id}, statut: ${completeRes.status}).`);
        setProjectName("");
        setSelectedParquetSourceId("");
        setTimeout(() => {
          setSuccess(null);
        }, 5000);
        return;
      }

      const csvFile = file;
      if (!csvFile) {
        throw new Error("Sélectionnez un fichier CSV.");
      }

      setUploadPhase("Initialisation de l'envoi...");
      setUploadProgress(0);

      // 1. Start multipart upload
      const startRes = await startMultipartUpload(csvFile.name, "text/csv");
      currentUploadId = startRes.upload_id;
      currentS3Key = startRes.s3_key;

      const totalParts = Math.ceil(csvFile.size / CHUNK_SIZE);
      const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

      // 2. Get pre-signed URLs
      setUploadPhase("Génération des autorisations d'upload...");
      const urlsRes = await getMultipartUrls(currentS3Key, currentUploadId, partNumbers);
      const urls = urlsRes.urls;

      setUploadPhase("Envoi des données en cours...");

      const uploadedParts: MultipartPart[] = [];
      // Track progress per part
      const partProgress = new Array(totalParts).fill(0);

      // Helper for uploading a single part
      const uploadPart = async (partNumber: number) => {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, csvFile.size);
        const chunk = csvFile.slice(start, end);
        const url = urls[partNumber];

        return new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url, true);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              partProgress[partNumber - 1] = event.loaded;
              const currentTotalUploaded = partProgress.reduce((a, b) => a + b, 0);
              const percentComplete = (currentTotalUploaded / csvFile.size) * 100;
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
      const workers = Array(Math.min(CONCURRENCY, totalParts)).fill(0).map(async () => {
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
        csvFile.size
      );

      setSuccess(`Projet créé (id: ${completeRes.project_id}, statut: ${completeRes.status}).`);
      setProjectName("");
      setFile(null);
      setUploadProgress(100);

      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 5000);

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

  const pathname = usePathname();

  useEffect(() => {
    refreshParquetSources();
  }, [refreshParquetSources]);

  return (
    <UploadContext.Provider
      value={{
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
        resetUploadState,
        setError
      }}
    >
      {children}
      {/* Global Upload Widget - shown only if loading and NOT on the home page */}
      {loading && pathname !== "/" && (
        <div className="fixed bottom-6 right-6 z-50 bg-card rounded-lg shadow-xl border w-80 overflow-hidden animate-in slide-in-from-bottom-5">
          <div className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm">Creation du projet</h4>
              <span className="text-xs text-muted-foreground font-mono">{Math.round(uploadProgress)}%</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{uploadPhase}</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (context === undefined) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}
