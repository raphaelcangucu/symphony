import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type {
  GitDiffCommitResponse,
  GitDiffCommitResult,
  GitDiffFileChange,
  GitDiffResult,
  GitDiffType,
  GitDiffWorkspace,
} from "@/types/gitDiff";

import { http, trackerPath } from "./http";

interface BackendGitDiffFileDto {
  path?: string | null;
  old_path?: string | null;
  oldPath?: string | null;
  status?: string | null;
  patch?: string | null;
}

interface BackendGitDiffRepoDto {
  repo?: string | null;
  files?: BackendGitDiffFileDto[] | null;
}

interface BackendGitDiffEnvelope {
  data?: BackendGitDiffRepoDto[] | null;
  workspace?: { path?: string | null; available?: boolean | null } | null;
}

interface BackendGitCommitDto {
  repo?: string | null;
  sha?: string | null;
  message?: string | null;
  files?: string[] | null;
}

interface BackendGitCommitEnvelope {
  data?: BackendGitCommitDto[] | null;
  workspace?: { path?: string | null; available?: boolean | null } | null;
}

export async function getGitDiff(
  projectSlug: string,
  identifier: string,
  type: GitDiffType,
): Promise<GitDiffResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendGitDiffEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff`),
    { params: { type } },
  );

  return {
    repos: (response.data?.data ?? []).map(normalizeRepo),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function getThreadGitDiff(
  threadId: number,
  type: GitDiffType,
): Promise<GitDiffResult> {
  const response = await http.get<BackendGitDiffEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff`),
    { params: { type } },
  );

  return {
    repos: (response.data?.data ?? []).map(normalizeRepo),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function commitGitDiff(
  projectSlug: string,
  identifier: string,
  message: string,
): Promise<GitDiffCommitResponse> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");
  const commitMessage = requireNonBlank(message, "message");

  const response = await http.post<BackendGitCommitEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/commit`),
    { message: commitMessage },
  );

  return {
    commits: (response.data?.data ?? []).map(normalizeCommit),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function commitThreadGitDiff(threadId: number, message: string): Promise<GitDiffCommitResponse> {
  const commitMessage = requireNonBlank(message, "message");
  const response = await http.post<BackendGitCommitEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff/commit`),
    { message: commitMessage },
  );

  return {
    commits: (response.data?.data ?? []).map(normalizeCommit),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

function normalizeRepo(dto: BackendGitDiffRepoDto) {
  return {
    repo: dto.repo ?? "",
    files: (dto.files ?? []).map(normalizeFile),
  };
}

function normalizeFile(dto: BackendGitDiffFileDto): GitDiffFileChange {
  return {
    path: dto.path ?? "",
    oldPath: dto.oldPath ?? dto.old_path ?? null,
    status: dto.status ?? "modified",
    patch: dto.patch ?? "",
  };
}

function normalizeCommit(dto: BackendGitCommitDto): GitDiffCommitResult {
  return {
    repo: dto.repo ?? "",
    sha: dto.sha ?? "",
    message: dto.message ?? "",
    files: dto.files ?? [],
  };
}

function normalizeWorkspace(raw: BackendGitDiffEnvelope["workspace"]): GitDiffWorkspace {
  return {
    path: raw?.path ?? "",
    available: raw?.available ?? false,
  };
}
