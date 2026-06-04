import { http, trackerPath } from "./http";

export interface BackupRecord {
  id: number;
  category: string;
  filename: string;
  size_bytes: number;
  size_human: string;
  local_path: string;
  s3_synced: boolean;
  trigger: string | null;
  status: string | null;
  agent: string | null;
  created_at: string | null;
  expires_at: string | null;
}

export interface BackupListResponse {
  data: BackupRecord[];
  total: number;
}

export interface BackupStatsCategory {
  count: number;
  total_bytes: number;
  synced_count: number;
  latest: BackupRecord | null;
}

export interface BackupSourceDatabase {
  path: string | null;
  size_bytes: number;
  size_human: string;
  exists: boolean;
}

export interface BackupStatsResponse {
  categories: Record<string, BackupStatsCategory>;
  source_database?: BackupSourceDatabase;
}

export interface BackupCreateResponse {
  success: boolean;
  message: string;
  backup: BackupRecord | null;
}

export interface BackupMessageResponse {
  success: boolean;
  message: string;
  count?: number;
}

export async function listBackups(params?: { category?: string; status?: string }): Promise<BackupListResponse> {
  const response = await http.get<BackupListResponse>(trackerPath("/backups"), { params });
  return response.data;
}

export async function backupStats(): Promise<BackupStatsResponse> {
  const response = await http.get<BackupStatsResponse>(trackerPath("/backups/stats"));
  return response.data;
}

export async function createBackup(category: "database" | "all", params?: { trigger?: string }): Promise<BackupCreateResponse> {
  const response = await http.post<BackupCreateResponse>(trackerPath("/backups"), null, {
    params: { category, ...params },
  });
  return response.data;
}

export async function restoreBackup(id: number, target?: string | null): Promise<BackupMessageResponse> {
  const response = await http.post<BackupMessageResponse>(trackerPath(`/backups/${id}/restore`), null, {
    params: target ? { target } : {},
  });
  return response.data;
}

export async function cleanupBackups(): Promise<BackupMessageResponse> {
  const response = await http.post<BackupMessageResponse>(trackerPath("/backups/cleanup"));
  return response.data;
}

export async function deleteBackup(id: number): Promise<BackupMessageResponse> {
  const response = await http.delete<BackupMessageResponse>(trackerPath(`/backups/${id}`));
  return response.data;
}

export function backupDownloadUrl(id: number): string {
  return trackerPath(`/backups/${id}/download`);
}
