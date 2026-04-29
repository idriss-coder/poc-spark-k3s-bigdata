// Use local NEXT route proxy for external APIs to avoid Mixed Content / CORS.
const API_URL = "/api/proxy";

// --- Types ---

// --- Vulnerability Analysis Types ---

export type DataSchemaExhibition =
  | "restricted_internal"
  | "extended_internal"
  | "restricted_external"
  | "extended_external";

export type DataSchemaEntry = {
  id?: number;
  name: string;
  libelle?: string;
  exhibition: DataSchemaExhibition;
  use_in_analysis: boolean;
};

export type AnalysisType = "longitudinal" | "transversal";

export type AnalysisConfig = {
  risk_sheet_id: number;
  datas: DataSchemaEntry[];
  feared_event_columns: string[];
  analysis_type: AnalysisType;
  longitudinal_column: string | null;
};

export type UploadUrlResponse = {
  upload_url: string;
  s3_key: string;
};

export type UploadCompleteResponse = {
  project_id: number;
  status: string;
};

export type MultipartStartResponse = {
  upload_id: string;
  s3_key: string;
};

export type MultipartUrlsResponse = {
  urls: Record<number, string>;
};

export type MultipartPart = {
  PartNumber: number;
  ETag: string;
};

export type ExistingParquetSource = {
  project_id: number;
  project_name: string;
  parquet_s3_path: string;
  parquet_size_bytes: number | null;
  total_rows?: number | null;
  status: string;
  created_at: string;
};

export type ProjectListItem = {
  id: number;
  name: string;
  status: string;
  csv_size_bytes: number | null;
  parquet_size_bytes: number | null;
  total_rows?: number | null;
  source_project_id?: number | null;
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
  total_rows?: number | null;
  source_project_id?: number | null;
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
  preview: Record<string, unknown>[];
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
  phase: "queued" | "submitting" | "driver_pending" | "running" | "finalizing" | "completed" | "failed" | null;
  progress_source: "spark_ui_jobs" | "spark_ui_stages" | "status_tracker" | "driver_logs" | "system" | null;
  is_real_progress: boolean;
};

export type ResultResponse = {
  status: string;
  preview: unknown[];
  result_s3_path: string | null;
  result_format: string | null;
  result_row_count: number | null;
  download_url: string | null;
  created_at: string | null;
  ended_at: string | null;
};

export type AtRiskDetailsItem = {
  condition_value: unknown;
  sensible_value: unknown;
  count: number;
};

export type AtRiskDetailsResponse = {
  artifact_id: number;
  sensitive_variable: string;
  scope: string;
  variables: string[];
  at_risk_total: number;
  detail_row_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: AtRiskDetailsItem[];
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

// --- Upload ---

export async function getUploadUrl(): Promise<UploadUrlResponse> {
  const res = await fetch(`${API_URL}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse<UploadUrlResponse>(res);
}

export async function createProject(s3Key: string, projectName: string, sizeBytes: number): Promise<{ project_id: number; status: string }> {
  const res = await fetch(`${API_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ s3_key: s3Key, project_name: projectName, csv_size_bytes: sizeBytes }),
  });
  return handleResponse<{ project_id: number; status: string }>(res);
}

export async function uploadComplete(
  s3_key: string,
  project_name: string,
  sizeBytes: number
): Promise<UploadCompleteResponse> {
  const res = await fetch(`${API_URL}/upload-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ s3_key, project_name, csv_size_bytes: sizeBytes }),
  });
  return handleResponse<UploadCompleteResponse>(res);
}

// --- Multipart Upload ---

export async function startMultipartUpload(
  filename: string,
  contentType: string = "text/csv"
): Promise<MultipartStartResponse> {
  const res = await fetch(`${API_URL}/upload-multipart/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content_type: contentType }),
  });
  return handleResponse<MultipartStartResponse>(res);
}

export async function getMultipartUrls(
  s3Key: string,
  uploadId: string,
  partNumbers: number[]
): Promise<MultipartUrlsResponse> {
  const res = await fetch(`${API_URL}/upload-multipart/urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_key: s3Key,
      upload_id: uploadId,
      part_numbers: partNumbers,
    }),
  });
  return handleResponse<MultipartUrlsResponse>(res);
}

export async function completeMultipartUpload(
  s3Key: string,
  uploadId: string,
  parts: MultipartPart[],
  projectName: string,
  sizeBytes: number
): Promise<UploadCompleteResponse> {
  const res = await fetch(`${API_URL}/upload-multipart/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_key: s3Key,
      upload_id: uploadId,
      parts,
      project_name: projectName,
      csv_size_bytes: sizeBytes,
    }),
  });
  return handleResponse<UploadCompleteResponse>(res);
}

export async function abortMultipartUpload(
  s3Key: string,
  uploadId: string
): Promise<void> {
  const res = await fetch(
    `${API_URL}/upload-multipart/abort?s3_key=${encodeURIComponent(s3Key)}&upload_id=${encodeURIComponent(uploadId)}`,
    {
      method: "DELETE",
    }
  );
  return handleResponse<void>(res);
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

export async function listExistingParquetSources(): Promise<ExistingParquetSource[]> {
  const res = await fetch(`${API_URL}/projects/parquet-sources`);
  return handleResponse<ExistingParquetSource[]>(res);
}

export async function createProjectFromParquet(
  sourceProjectId: number,
  projectName: string
): Promise<UploadCompleteResponse> {
  const res = await fetch(`${API_URL}/projects/from-parquet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_project_id: sourceProjectId, project_name: projectName }),
  });
  return handleResponse<UploadCompleteResponse>(res);
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

export type DRAnalysisPayload = {
  types: {
    sensible: string[];
    ee: string[];
    er: string[];
    ie: string[];
    ir: string[];
  };
  analysis_type: "transversal" | "longitudinal";
  longitudinal_column: string | null;
};

export async function launchAnalysis(
  id: number,
  payload: DRAnalysisPayload
): Promise<AnalyseResponse> {
  const res = await fetch(`${API_URL}/projects/${id}/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

export async function getAtRiskDetails(
  projectId: number,
  artifactId: number,
  page: number = 1,
  pageSize: number = 20
): Promise<AtRiskDetailsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await fetch(`${API_URL}/projects/${projectId}/at-risk/${artifactId}?${params.toString()}`);
  return handleResponse<AtRiskDetailsResponse>(res);
}
