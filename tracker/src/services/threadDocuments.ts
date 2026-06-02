import type { ThreadDocument, ThreadDocumentList } from "@/types/threadDocument";

import { http, trackerPath, unwrapData } from "./http";

interface BackendThreadDocumentDto {
  id?: string | null;
  kind?: string | null;
  path?: string | null;
  title?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

interface BackendThreadDocumentListDto {
  available?: boolean | null;
  reason?: string | null;
  documents?: BackendThreadDocumentDto[] | null;
}

export function normalizeThreadDocument(dto: BackendThreadDocumentDto): ThreadDocument {
  return {
    id: dto.id ?? dto.path ?? "",
    kind: "draft",
    path: dto.path ?? "",
    title: dto.title ?? dto.path ?? "Untitled",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? null,
  };
}

export function normalizeThreadDocumentList(dto: BackendThreadDocumentListDto): ThreadDocumentList {
  return {
    available: Boolean(dto.available),
    reason: dto.reason ?? null,
    documents: (dto.documents ?? []).map(normalizeThreadDocument),
  };
}

export async function listThreadDocuments(threadId: number): Promise<ThreadDocumentList> {
  const response = await http.get(threadDocumentsPath(threadId));
  return normalizeThreadDocumentList(unwrapData<BackendThreadDocumentListDto>(response));
}

export async function readThreadDocument(threadId: number, path: string): Promise<string> {
  const encodedPath = encodeDocumentPath(path);
  const response = await http.get(`${threadDocumentsPath(threadId)}/${encodedPath}`);
  return unwrapData<{ content: string }>(response).content;
}

function threadDocumentsPath(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }

  return trackerPath(`/assistant/threads/${threadId}/documents`);
}

function encodeDocumentPath(path: string): string {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("path is required");

  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Document path cannot include . or .. segments");
  }

  return segments.map(encodeURIComponent).join("/");
}

const FREEFORM_WORKSPACE_PATH_RE = /(?:^|\/)assistant\/freeform\/\d+\/(.+)$/i;

export function normalizeAssistantDocumentHref(href: string | null | undefined): string | null {
  if (!href) return null;

  let trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("mailto:")) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;

  trimmed = trimmed.replace(/^file:\/\//i, "");

  const freeformMatch = trimmed.match(FREEFORM_WORKSPACE_PATH_RE);
  if (freeformMatch) {
    const relativePath = freeformMatch[1];
    return relativePath.toLowerCase().endsWith(".md") ? relativePath : null;
  }

  let path = trimmed.replace(/^\.\//, "");
  if (!path.toLowerCase().endsWith(".md")) return null;

  if (path.startsWith("/")) {
    const segments = path.split("/").filter(Boolean);
    const basename = segments[segments.length - 1];
    return basename?.toLowerCase().endsWith(".md") ? basename : null;
  }

  return path;
}

export function isAssistantWorkspaceMarkdownHref(href: string | null | undefined): boolean {
  return normalizeAssistantDocumentHref(href) !== null;
}
