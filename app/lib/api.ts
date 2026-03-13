// Use local NEXT route proxy for external APIs to avoid Mixed Content / CORS.
const API_URL = "/api/proxy";

// --- Types ---

export type UploadCompleteResponse = {
  project_id: number;
  status: string;
};

export type StreamingInitiateResponse = {
  upload_id: string;
  s3_key: string;
};

export type StreamingPartResponse = {
  part_number: number;
  etag: string;
};

export type StreamingCompletePart = {
  part_number: number;
  etag: string;
};

export type ProjectListItem = {
  id: number;
  name: string;
  status: string;
  csv_size_bytes: number | null;
  parquet_size_bytes: number | null;
  created_at: string;
};

export type ProjectDetail = {
  id: number;
  name: string;
  status: string;
  csv_s3_path: string | null;
  parquet_s3_path: string | null;
  csv_size_bytes: number | null;
  parquet_size_bytes: number | null;
  created_at: string;
  convert_started_at: string | null;
  convert_ended_at: string | null;
};

export type ColumnInfo = {
  name: string;
  type: string;
};

export type ColumnsResponse = {
  columns: ColumnInfo[];
  preview: Record<string, any>[];
};

export type AnalyseResponse = {
  analysis_id: number;
  status: string;
};

export type ProgressResponse = {
  status: string;
  progress: number;
  message: string | null;
  step: string | null;
};

export type ResultResponse = {
  result: Record<string, number>;
  created_at: string | null;
  ended_at: string | null;
};

// --- Helpers ---

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.detail ?? text;
    } catch {
      // keep text
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

// --- Upload Streaming ---

export async function initiateStreamingUpload(
  fileName: string,
  fileType: string = "text/csv",
  totalBytes: number = 0
): Promise<StreamingInitiateResponse> {
  const res = await fetch(`${API_URL}/upload/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, file_type: fileType, total_bytes: totalBytes }),
  });
  return handleResponse<StreamingInitiateResponse>(res);
}

export async function uploadStreamingPart(
  uploadId: string,
  s3Key: string,
  partNumber: number,
  chunk: Blob
): Promise<StreamingPartResponse> {
  const url = `${API_URL}/upload/part?upload_id=${encodeURIComponent(uploadId)}&s3_key=${encodeURIComponent(s3Key)}&part_number=${partNumber}`;
  const res = await fetch(url, {
    method: "PUT",
    body: chunk,
    headers: { "Content-Type": "application/octet-stream" },
  });
  return handleResponse<StreamingPartResponse>(res);
}

export async function completeStreamingUpload(
  uploadId: string,
  s3Key: string,
  parts: StreamingCompletePart[],
  projectName: string,
  sizeBytes: number
): Promise<UploadCompleteResponse> {
  const res = await fetch(`${API_URL}/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_id: uploadId,
      s3_key: s3Key,
      parts,
      project_name: projectName,
      csv_size_bytes: sizeBytes,
    }),
  });
  return handleResponse<UploadCompleteResponse>(res);
}

export async function abortStreamingUpload(
  uploadId: string,
  s3Key: string
): Promise<void> {
  const res = await fetch(
    `${API_URL}/upload/abort?upload_id=${encodeURIComponent(uploadId)}&s3_key=${encodeURIComponent(s3Key)}`,
    { method: "DELETE" }
  );
  return handleResponse<void>(res);
}

export type UploadProgressResponse = {
  upload_id: string;
  percentage: number;
  parts_done: number;
  parts_total: number;
  bytes_done: number;
  bytes_total: number;
};

export async function getUploadProgress(uploadId: string): Promise<UploadProgressResponse> {
  const res = await fetch(`${API_URL}/upload/progress/${encodeURIComponent(uploadId)}`);
  return handleResponse<UploadProgressResponse>(res);
}

// --- Projects ---

export async function listProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_URL}/projects`);
  return handleResponse<ProjectListItem[]>(res);
}

export async function getProject(id: number): Promise<ProjectDetail> {
  const res = await fetch(`${API_URL}/projects/${id}`);
  return handleResponse<ProjectDetail>(res);
}

export async function deleteProject(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${id}`, {
    method: "DELETE",
  });
  return handleResponse<void>(res);
}

// --- Columns ---

export async function getProjectColumns(id: number): Promise<ColumnsResponse> {
  const res = await fetch(`${API_URL}/projects/${id}/columns`);
  return handleResponse<ColumnsResponse>(res);
}

// --- Utils ---
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// --- Storage Efficiency Metrics (CSV → Parquet) ---

export type CompressionStats = {
  /** Ratio parquet/csv  ex: 0.25 signifie que parquet = 25% de la taille CSV */
  compressionRatio: number;
  /** Réduction de taille en pourcentage  ex: 75 → "75% smaller" */
  sizeReductionPct: number;
  /** Octets économisés */
  savedBytes: number;
  /**
   * Estimation du speedup Spark en lecture (scan complet).
   * Basé sur des benchmarks empiriques Spark : Parquet columnar reads
   * sont typiquement 5–10× plus rapides que CSV row-by-row.
   * On scale ce facteur proportionnellement au ratio de compression
   * en restant dans la fourchette [3×, 15×].
   */
  sparkReadSpeedup: number;
};

/**
 * Calcule les métriques d'efficacité de stockage CSV → Parquet.
 * Renvoie `null` si les deux tailles ne sont pas disponibles.
 */
export function computeCompressionStats(
  csvBytes: number | null | undefined,
  parquetBytes: number | null | undefined
): CompressionStats | null {
  if (!csvBytes || !parquetBytes || csvBytes <= 0) return null;

  const compressionRatio = parquetBytes / csvBytes;
  const sizeReductionPct = Math.round((1 - compressionRatio) * 100);
  const savedBytes = csvBytes - parquetBytes;

  // Spark read speedup : interpolation dans [3×, 15×] selon le ratio
  // ratio 1.0 → 3×,  ratio 0.0 → 15×
  const BASE_SPEEDUP = 3;
  const MAX_SPEEDUP_BONUS = 12;
  const sparkReadSpeedup = parseFloat(
    (BASE_SPEEDUP + MAX_SPEEDUP_BONUS * Math.max(0, 1 - compressionRatio)).toFixed(1)
  );

  return { compressionRatio, sizeReductionPct, savedBytes, sparkReadSpeedup };
}

// --- Analysis ---

export async function launchAnalysis(
  id: number,
  columns: string[]
): Promise<AnalyseResponse> {
  const res = await fetch(`${API_URL}/projects/${id}/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns }),
  });
  return handleResponse<AnalyseResponse>(res);
}

// --- Progress ---

export async function getProgress(id: number): Promise<ProgressResponse> {
  const res = await fetch(`${API_URL}/projects/${id}/progress`);
  return handleResponse<ProgressResponse>(res);
}

// --- Result ---

export async function getResult(id: number): Promise<ResultResponse> {
  const res = await fetch(`${API_URL}/projects/${id}/result`);
  return handleResponse<ResultResponse>(res);
}
