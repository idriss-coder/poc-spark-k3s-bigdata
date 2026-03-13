"use client";

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import {
  initiateStreamingUpload,
  completeStreamingUpload,
  abortStreamingUpload,
  getUploadProgress,
  StreamingCompletePart,
} from "@/app/lib/api";

type UploadContextType = {
  projectName: string;
  setProjectName: (name: string) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  loading: boolean;
  error: string | null;
  success: string | null;
  uploadProgress: number;
  uploadPhase: string;
  startUpload: () => Promise<void>;
  resetUploadState: () => void;
  setError: (error: string | null) => void;
};

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const CONCURRENCY = 4;

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");

  const submittingRef = useRef(false);

  const resetUploadState = useCallback(() => {
    setProjectName("");
    setFile(null);
    setLoading(false);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);
    setUploadPhase("");
  }, []);

  const startUpload = async () => {
    if (submittingRef.current) return;
    if (!projectName.trim()) {
       setError("Indiquez un nom de projet.");
       return;
    }
    if (!file) {
       setError("Sélectionnez un fichier CSV.");
       return;
    }

    submittingRef.current = true;
    setError(null);
    setSuccess(null);
    setLoading(true);

    let currentUploadId = "";
    let currentS3Key = "";
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    try {
      setUploadPhase("Initialisation de l'envoi...");
      setUploadProgress(0);
      const initRes = await initiateStreamingUpload(file.name, file.type || "text/csv", file.size);
      currentUploadId = initRes.upload_id;
      currentS3Key = initRes.s3_key;

      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      setUploadPhase(`Envoi du fichier en cours (0 / ${totalParts} parties)...`);

      pollInterval = setInterval(async () => {
        try {
          const prog = await getUploadProgress(currentUploadId);
          setUploadProgress(prog.percentage);
          setUploadPhase(`Envoi en cours... ${prog.parts_done} / ${prog.parts_total} parties sur S3`);
        } catch {
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 500);

      const completedParts: StreamingCompletePart[] = [];

      const uploadPartXHR = (partNumber: number, chunk: Blob): Promise<StreamingCompletePart> => {
        return new Promise((resolve, reject) => {
          const url = `/api/proxy/upload/part?upload_id=${encodeURIComponent(currentUploadId)}&s3_key=${encodeURIComponent(currentS3Key)}&part_number=${partNumber}`;
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url, true);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const res = JSON.parse(xhr.responseText);
                resolve({ part_number: res.part_number, etag: res.etag });
              } catch {
                reject(new Error(`Réponse invalide pour la partie ${partNumber}`));
              }
            } else {
              reject(new Error(`Échec partie ${partNumber} (HTTP ${xhr.status})`));
            }
          };

          xhr.onerror = () => reject(new Error(`Erreur réseau (partie ${partNumber})`));
          xhr.send(chunk);
        });
      };

      const queue = Array.from({ length: totalParts }, (_, i) => i + 1);

      const worker = async () => {
        while (queue.length > 0) {
          const partNumber = queue.shift();
          if (partNumber === undefined) break;
          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const part = await uploadPartXHR(partNumber, chunk);
          completedParts.push(part);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, totalParts) }, () => worker())
      );

      setUploadPhase("Assemblage et finalisation...");
      const completeRes = await completeStreamingUpload(
        currentUploadId,
        currentS3Key,
        completedParts,
        projectName.trim(),
        file.size
      );

      setUploadProgress(100);
      setSuccess(`Projet créé (id: ${completeRes.project_id}, statut: ${completeRes.status}).`);
      setProjectName("");
      setFile(null);
      
      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 5000);

    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      if (currentUploadId && currentS3Key) {
        abortStreamingUpload(currentUploadId, currentS3Key).catch(console.error);
      }
      setError(err instanceof Error ? err.message : "Une erreur est survenue lors de l'upload.");
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <UploadContext.Provider
      value={{
        projectName,
        setProjectName,
        file,
        setFile,
        loading,
        error,
        success,
        uploadProgress,
        uploadPhase,
        startUpload,
        resetUploadState,
        setError
      }}
    >
      {children}
      {/* Global Upload Widget */}
      {loading && (
        <div className="fixed bottom-6 right-6 z-50 bg-card rounded-lg shadow-xl border w-80 overflow-hidden animate-in slide-in-from-bottom-5">
           <div className="p-4 space-y-3">
             <div className="flex justify-between items-center">
                 <h4 className="font-semibold text-sm">Upload en cours...</h4>
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
