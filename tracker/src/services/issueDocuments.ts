import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { assertSafeDocumentPath, requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { IssueDocument, IssueDocumentKind, IssueDocumentList } from "@/types/issueDocument";

import { http, trackerPath, unwrapData } from "./http";

interface BackendIssueDocumentDto {
  id?: string | null;
  kind?: string | null;
  path?: string | null;
  title?: string | null;
  updated_at?: string | null;
}

interface BackendIssueDocumentListDto {
  available?: boolean | null;
  reason?: string | null;
  documents?: BackendIssueDocumentDto[] | null;
}

const DOCUMENT_KINDS: readonly IssueDocumentKind[] = ["spec", "plan", "handoff"];

export function normalizeIssueDocument(dto: BackendIssueDocumentDto): IssueDocument {
  const kind = DOCUMENT_KINDS.includes(dto.kind as IssueDocumentKind) ? (dto.kind as IssueDocumentKind) : "spec";

  return {
    id: dto.id ?? dto.path ?? "",
    kind,
    path: dto.path ?? "",
    title: dto.title ?? dto.path ?? "Untitled",
    updatedAt: dto.updated_at ?? null,
  };
}

export function normalizeIssueDocumentList(dto: BackendIssueDocumentListDto): IssueDocumentList {
  return {
    available: Boolean(dto.available),
    reason: dto.reason ?? null,
    documents: (dto.documents ?? []).map(normalizeIssueDocument),
  };
}

export async function listIssueDocuments(projectSlug: string, identifier: string): Promise<IssueDocumentList> {
  const response = await http.get(issueDocumentsPath(projectSlug, identifier));

  return normalizeIssueDocumentList(unwrapData<BackendIssueDocumentListDto>(response));
}

export async function readIssueDocument(projectSlug: string, identifier: string, path: string): Promise<string> {
  const encodedPath = encodeDocumentPath(path);
  const response = await http.get(`${issueDocumentsPath(projectSlug, identifier)}/${encodedPath}`);

  return unwrapData<{ content: string }>(response).content;
}

function issueDocumentsPath(projectSlug: string, identifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  return trackerPath(
    `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/documents`,
  );
}

function encodeDocumentPath(path: string): string {
  const normalizedPath = requireNonBlank(path, "path");
  assertSafeDocumentPath(normalizedPath);

  return normalizedPath.split("/").map(encodeURIComponent).join("/");
}
