// Use local NEXT route proxy for external APIs to avoid Mixed Content / CORS.
const API_URL = "/api/proxy";

// --- Types ---

export type UploadUrlResponse = {
  upload_url: string;
  s3_key: string;
};

export type UploadCompleteResponse = {
  project_id: number;
  status: string;
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
