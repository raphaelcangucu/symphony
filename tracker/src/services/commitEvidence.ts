import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type {
  CommitEvidenceDetail,
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
  files?: BackendFileDto[] | null;
}

interface BackendFileDto {
  path?: string | null;
  old_path?: string | null;
  status?: string | null;
  patch?: string | null;
}

interface BackendCommitListEnvelope {
  data?: BackendCommitDto[] | null;
  workspace?: { path?: string | null; available?: boolean | null } | null;
}

interface BackendCommitDetailEnvelope {
  data?: BackendCommitDto | null;
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
): Promise<{ commits: CommitEvidenceSummary[]; workspace: CommitEvidenceWorkspace }> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendCommitListEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/commit_evidence`,
    ),
  );

  return {
    commits: (response.data?.data ?? []).map(normalizeSummary),
    workspace: normalizeWorkspace(response.data?.workspace),
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
