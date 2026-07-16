import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type {
  GitDiffCommitResponse,
  GitDiffCommitResult,
  GitDiffFileChange,
  GitDiffFileEntry,
  GitDiffFilesPage,
  GitDiffPatchResult,
  GitDiffPushResponse,
  GitDiffPushResult,
  GitDiffRepoStat,
  GitDiffRepoSummary,
  GitDiffResult,
  GitDiffStatsResult,
  GitDiffSummariesResult,
  GitDiffType,
  GitDiffWorkspace,
} from "@/types/gitDiff";

import { http, trackerPath } from "./http";

interface BackendGitDiffFileDto {
  path?: string | null;
  old_path?: string | null;
  status?: string | null;
  patch?: string | null;
}

interface BackendGitDiffRepoDto {
  repo?: string | null;
  branch?: string | null;
  base?: string | null;
  ahead?: number | null;
  behind?: number | null;
  files?: BackendGitDiffFileDto[] | null;
}

interface BackendWorkspaceDto {
  path?: string | null;
  available?: boolean | null;
}

interface BackendGitDiffEnvelope {
  data?: BackendGitDiffRepoDto[] | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitCommitDto {
  repo?: string | null;
  sha?: string | null;
  message?: string | null;
  files?: string[] | null;
}

interface BackendGitCommitEnvelope {
  data?: BackendGitCommitDto[] | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffStatDto {
  repo?: string | null;
  branch?: string | null;
  base?: string | null;
  files_changed?: number | null;
  additions?: number | null;
  deletions?: number | null;
  untracked?: number | null;
}

interface BackendGitDiffStatsEnvelope {
  data?: BackendGitDiffStatDto[] | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffFileEntryDto {
  repo?: string | null;
  path?: string | null;
  old_path?: string | null;
  status?: string | null;
  additions?: number | null;
  deletions?: number | null;
  binary?: boolean | null;
}

interface BackendGitDiffFilesEnvelope {
  files?: BackendGitDiffFileEntryDto[] | null;
  total?: number | null;
  limit?: number | null;
  next_cursor?: string | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffPatchDto {
  repo?: string | null;
  path?: string | null;
  status?: string | null;
  binary?: boolean | null;
  truncated?: boolean | null;
  patch?: string | null;
}

interface BackendGitDiffPatchEnvelope {
  data?: BackendGitDiffPatchDto | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffRepoSummaryDto {
  repo?: string | null;
  branch?: string | null;
  ahead_count?: number | null;
  dirty?: boolean | null;
}

interface BackendGitDiffSummariesEnvelope {
  data?: BackendGitDiffRepoSummaryDto[] | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffPushResultDto {
  repo?: string | null;
  ok?: boolean | null;
  error?: string | null;
}

interface BackendGitDiffPushEnvelope {
  data?: BackendGitDiffPushResultDto[] | null;
  workspace?: BackendWorkspaceDto | null;
}

interface BackendGitDiffGenerateCommitMessageDto {
  message?: string | null;
}

interface BackendGitDiffGenerateCommitMessageEnvelope {
  data?: BackendGitDiffGenerateCommitMessageDto | null;
}

export interface GitDiffRequestOptions {
  signal?: AbortSignal;
}

export interface GitDiffFilesListOptions extends GitDiffRequestOptions {
  repo?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
}

export async function getGitDiff(
  projectSlug: string,
  identifier: string,
  type: GitDiffType,
  options?: GitDiffRequestOptions,
): Promise<GitDiffResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendGitDiffEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff`),
    { params: { type }, signal: options?.signal },
  );

  return {
    repos: (response.data?.data ?? []).map(normalizeRepo),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function getThreadGitDiff(
  threadId: number,
  type: GitDiffType,
  options?: GitDiffRequestOptions,
): Promise<GitDiffResult> {
  const response = await http.get<BackendGitDiffEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff`),
    { params: { type }, signal: options?.signal },
  );

  return {
    repos: (response.data?.data ?? []).map(normalizeRepo),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function getGitDiffStats(
  projectSlug: string,
  identifier: string,
  type: GitDiffType,
  options?: GitDiffRequestOptions,
): Promise<GitDiffStatsResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendGitDiffStatsEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/stats`),
    { params: { type }, signal: options?.signal },
  );

  return {
    stats: (response.data?.data ?? []).map(normalizeStat),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function getThreadGitDiffStats(
  threadId: number,
  type: GitDiffType,
  options?: GitDiffRequestOptions,
): Promise<GitDiffStatsResult> {
  const response = await http.get<BackendGitDiffStatsEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff/stats`),
    { params: { type }, signal: options?.signal },
  );

  return {
    stats: (response.data?.data ?? []).map(normalizeStat),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function getGitDiffFiles(
  projectSlug: string,
  identifier: string,
  type: GitDiffType,
  options?: GitDiffFilesListOptions,
): Promise<GitDiffFilesPage> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendGitDiffFilesEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/files`),
    { params: filesListParams(type, options), signal: options?.signal },
  );

  return normalizeFilesPage(response.data);
}

export async function getThreadGitDiffFiles(
  threadId: number,
  type: GitDiffType,
  options?: GitDiffFilesListOptions,
): Promise<GitDiffFilesPage> {
  const response = await http.get<BackendGitDiffFilesEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff/files`),
    { params: filesListParams(type, options), signal: options?.signal },
  );

  return normalizeFilesPage(response.data);
}

export async function getGitDiffPatch(
  projectSlug: string,
  identifier: string,
  type: GitDiffType,
  repo: string,
  path: string,
  options?: GitDiffRequestOptions,
): Promise<GitDiffPatchResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");
  const repoName = requireNonBlank(repo, "repo");
  const filePath = requireNonBlank(path, "path");

  const response = await http.get<BackendGitDiffPatchEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/patch`),
    { params: { type, repo: repoName, path: filePath }, signal: options?.signal },
  );

  return normalizePatch(response.data);
}

export async function getThreadGitDiffPatch(
  threadId: number,
  type: GitDiffType,
  repo: string,
  path: string,
  options?: GitDiffRequestOptions,
): Promise<GitDiffPatchResult> {
  const repoName = requireNonBlank(repo, "repo");
  const filePath = requireNonBlank(path, "path");

  const response = await http.get<BackendGitDiffPatchEnvelope>(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/diff/patch`),
    { params: { type, repo: repoName, path: filePath }, signal: options?.signal },
  );

  return normalizePatch(response.data);
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

export async function getGitDiffSummaries(
  projectSlug: string,
  identifier: string,
  options: GitDiffRequestOptions = {},
): Promise<GitDiffSummariesResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendGitDiffSummariesEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/summaries`),
    { signal: options.signal },
  );

  return {
    summaries: (response.data?.data ?? []).map(normalizeRepoSummary),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function pushGitDiff(projectSlug: string, identifier: string): Promise<GitDiffPushResponse> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.post<BackendGitDiffPushEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/push`),
    {},
  );

  return {
    results: (response.data?.data ?? []).map(normalizePushResult),
    workspace: normalizeWorkspace(response.data?.workspace),
  };
}

export async function generateCommitMessage(projectSlug: string, identifier: string): Promise<string> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.post<BackendGitDiffGenerateCommitMessageEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/diff/generate-commit-message`,
    ),
    {},
  );

  return response.data?.data?.message ?? "";
}

function filesListParams(type: GitDiffType, options?: GitDiffFilesListOptions): Record<string, unknown> {
  return {
    type,
    repo: options?.repo || undefined,
    q: options?.q || undefined,
    limit: options?.limit,
    cursor: options?.cursor || undefined,
  };
}

function normalizeRepo(dto: BackendGitDiffRepoDto) {
  return {
    repo: dto.repo ?? "",
    branch: dto.branch ?? null,
    base: dto.base ?? null,
    ahead: normalizeOptionalNumber(dto.ahead),
    behind: normalizeOptionalNumber(dto.behind),
    files: (dto.files ?? []).map(normalizeFile),
  };
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeFile(dto: BackendGitDiffFileDto): GitDiffFileChange {
  return {
    path: dto.path ?? "",
    oldPath: dto.old_path ?? null,
    status: dto.status ?? "modified",
    patch: dto.patch ?? "",
  };
}

function normalizeStat(dto: BackendGitDiffStatDto): GitDiffRepoStat {
  return {
    repo: dto.repo ?? "",
    branch: dto.branch ?? null,
    base: dto.base ?? null,
    filesChanged: normalizeCount(dto.files_changed),
    additions: normalizeCount(dto.additions),
    deletions: normalizeCount(dto.deletions),
    untracked: normalizeCount(dto.untracked),
  };
}

function normalizeFileEntry(dto: BackendGitDiffFileEntryDto): GitDiffFileEntry {
  return {
    repo: dto.repo ?? "",
    path: dto.path ?? "",
    oldPath: dto.old_path ?? null,
    status: dto.status ?? "modified",
    additions: normalizeOptionalNumber(dto.additions),
    deletions: normalizeOptionalNumber(dto.deletions),
    binary: dto.binary ?? false,
  };
}

function normalizeFilesPage(dto: BackendGitDiffFilesEnvelope | undefined): GitDiffFilesPage {
  return {
    files: (dto?.files ?? []).map(normalizeFileEntry),
    total: normalizeCount(dto?.total),
    limit: normalizeCount(dto?.limit),
    nextCursor: dto?.next_cursor ?? null,
    workspace: normalizeWorkspace(dto?.workspace),
  };
}

function normalizePatch(dto: BackendGitDiffPatchEnvelope | undefined): GitDiffPatchResult {
  const data = dto?.data ?? {};
  return {
    repo: data.repo ?? "",
    path: data.path ?? "",
    status: data.status ?? "modified",
    binary: data.binary ?? false,
    truncated: data.truncated ?? false,
    patch: data.patch ?? "",
    workspace: normalizeWorkspace(dto?.workspace),
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

export function normalizeRepoSummary(dto: BackendGitDiffRepoSummaryDto): GitDiffRepoSummary {
  return {
    repo: dto.repo ?? "",
    branch: dto.branch ?? null,
    aheadCount: normalizeCount(dto.ahead_count),
    dirty: dto.dirty ?? false,
  };
}

function normalizePushResult(dto: BackendGitDiffPushResultDto): GitDiffPushResult {
  const result: GitDiffPushResult = {
    repo: dto.repo ?? "",
    ok: dto.ok ?? false,
  };

  if (dto.error) {
    result.error = dto.error;
  }

  return result;
}

function normalizeWorkspace(raw: BackendWorkspaceDto | null | undefined): GitDiffWorkspace {
  return {
    path: raw?.path ?? "",
    available: raw?.available ?? false,
  };
}
