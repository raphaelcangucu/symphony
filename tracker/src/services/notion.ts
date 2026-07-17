import { http, trackerPath, unwrapData } from "@/services/http";

export type NotionImportResult = {
  importId: string;
  title: string;
  kind: "page" | "database" | string;
  sourceUrl: string;
  markdownPath: string;
  assetsDir: string;
  metaPath: string;
  assetCount: number;
  warnings: string[];
  previewMarkdown: string;
};

export type NotionImportDetail = {
  meta: Record<string, unknown>;
  markdown: string;
  assets: string[];
};

interface BackendNotionImportResultDto {
  import_id?: string | null;
  title?: string | null;
  kind?: string | null;
  source_url?: string | null;
  markdown_path?: string | null;
  assets_dir?: string | null;
  meta_path?: string | null;
  asset_count?: number | null;
  warnings?: string[] | null;
  preview_markdown?: string | null;
}

interface BackendNotionImportDetailDto {
  meta?: Record<string, unknown> | null;
  markdown?: string | null;
  assets?: string[] | null;
}

export function normalizeNotionImportResult(dto: BackendNotionImportResultDto): NotionImportResult {
  const importId = dto.import_id?.trim();
  if (!importId) {
    throw new Error("Notion import response is missing import_id");
  }

  return {
    importId,
    title: dto.title?.trim() || "Untitled",
    kind: dto.kind?.trim() || "page",
    sourceUrl: dto.source_url?.trim() || "",
    markdownPath: dto.markdown_path?.trim() || "",
    assetsDir: dto.assets_dir?.trim() || "",
    metaPath: dto.meta_path?.trim() || "",
    assetCount: typeof dto.asset_count === "number" ? dto.asset_count : 0,
    warnings: Array.isArray(dto.warnings) ? dto.warnings.filter((warning) => typeof warning === "string") : [],
    previewMarkdown: dto.preview_markdown ?? "",
  };
}

export function normalizeNotionImportDetail(dto: BackendNotionImportDetailDto): NotionImportDetail {
  return {
    meta: dto.meta && typeof dto.meta === "object" ? dto.meta : {},
    markdown: typeof dto.markdown === "string" ? dto.markdown : "",
    assets: Array.isArray(dto.assets) ? dto.assets.filter((asset) => typeof asset === "string") : [],
  };
}

export async function importNotionPage(url: string): Promise<NotionImportResult> {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) {
    throw new Error("url is required");
  }

  const response = await http.post(trackerPath("/notion/import"), { url: trimmed });
  return normalizeNotionImportResult(unwrapData<BackendNotionImportResultDto>(response));
}

export async function fetchNotionImport(importId: string): Promise<NotionImportDetail> {
  const trimmed = typeof importId === "string" ? importId.trim() : "";
  if (!trimmed) {
    throw new Error("importId is required");
  }

  const response = await http.get(trackerPath(`/notion/imports/${encodeURIComponent(trimmed)}`));
  return normalizeNotionImportDetail(unwrapData<BackendNotionImportDetailDto>(response));
}
