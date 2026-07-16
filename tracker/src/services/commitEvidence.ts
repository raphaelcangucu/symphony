import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type {
  CommitEvidenceDetail,
  CommitEvidencePage,
  CommitEvidenceSummary,
  CommitEvidenceWorkspace,
} from "@/types/commitEvidence";

import { http, trackerPath } from "./http";

interface BackendCommitDto {
  repo?: string | null;
  sha?: string | null;
  short_sha?: string | null;
  message?: string | null;
  author?: string | null;
  authored_at?: string | null;
  files_changed?: number | null;
  insertions?: number | null;
  deletions?: number | null;
  online?: boolean | null;
  files?: BackendFileDto[] | null;
}

interface BackendFileDto {
  path?: string | null;
  old_path?: string | null;
  status?: string | null;
  patch?: string | null;
}

interface BackendCommitListEnvelope {
  commits?: BackendCommitDto[] | null;
  data?: BackendCommitDto[] | null;
  total?: number | null;
  limit?: number | null;
  next_cursor?: string | null;
  workspace?: { path?: string | null; available?: boolean | null } | null;
}

interface BackendCommitDetailEnvelope {
  data?: BackendCommitDto | null;
}

export interface ListCommitEvidenceParams {
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

function normalizeSummary(dto: BackendCommitDto): CommitEvidenceSummary {
  return {
    repo: dto.repo ?? "",
    sha: dto.sha ?? "",
    shortSha: dto.short_sha ?? "",
    message: dto.message ?? "",
    author: dto.author ?? "",
    authoredAt: dto.authored_at ?? "",
    filesChanged: dto.files_changed ?? 0,
    insertions: dto.insertions ?? 0,
    deletions: dto.deletions ?? 0,
    online: dto.online === true,
  };
}

function normalizeFile(dto: BackendFileDto) {
  return {
    path: dto.path ?? "",
    oldPath: dto.old_path ?? null,
    status: dto.status ?? "modified",
    patch: dto.patch ?? "",
  };
}

function normalizeDetail(dto: BackendCommitDto): CommitEvidenceDetail {
  return {
    ...normalizeSummary(dto),
    files: (dto.files ?? []).map(normalizeFile),
  };
}

function normalizeWorkspace(raw: BackendCommitListEnvelope["workspace"]): CommitEvidenceWorkspace {
  return {
    path: raw?.path ?? "",
    available: raw?.available ?? false,
  };
}

export async function listCommitEvidence(
  projectSlug: string,
  identifier: string,
  params: ListCommitEvidenceParams = {},
): Promise<CommitEvidencePage> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const query = new URLSearchParams();
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const querySuffix = query.size > 0 ? `?${query.toString()}` : "";

  const response = await http.get<BackendCommitListEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/commit_evidence${querySuffix}`,
    ),
    { signal: params.signal },
  );

  const raw = response.data;
  const commits = (raw?.commits ?? raw?.data ?? []).map(normalizeSummary);

  return {
    commits,
    total: raw?.total ?? commits.length,
    limit: raw?.limit ?? params.limit ?? commits.length,
    nextCursor: raw?.next_cursor ?? null,
    workspace: normalizeWorkspace(raw?.workspace),
  };
}

export async function getCommitEvidence(
  projectSlug: string,
  identifier: string,
  repo: string,
  sha: string,
): Promise<CommitEvidenceDetail> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendCommitDetailEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/commit_evidence/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}`,
    ),
  );

  return normalizeDetail(response.data?.data ?? {});
}
