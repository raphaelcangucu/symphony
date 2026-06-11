import type {
  PullRequest,
  PullRequestConversationEntry,
  PullRequestJob,
  PullRequestFixResult,
  MergePullRequestInput,
  MergePullRequestResult,
  PullRequestMonitorInfo,
  PullRequestPipeline,
  PullRequestResult,
  PullRequestMergeMethod,
  PullRequestState,
  PullRequestStatusContext,
  RerunResult,
  UpdateBranchResult,
} from "@/types/pull-request";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

import { http, trackerPath } from "./http";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

interface BackendJobDto {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  url?: string | null;
  started_at?: string | null;
  startedAt?: string | null;
  completed_at?: string | null;
  completedAt?: string | null;
}

interface BackendPipelineDto {
  name?: string | null;
  url?: string | null;
  jobs?: BackendJobDto[] | null;
}

interface BackendStatusDto {
  context?: string | null;
  state?: string | null;
  url?: string | null;
  description?: string | null;
}

interface BackendConversationDto {
  author?: string | null;
  body?: string | null;
  kind?: string | null;
  review_state?: string | null;
  reviewState?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
}

interface BackendMonitorDto {
  last_action?: string | null;
  summary?: string | null;
  auto_rework_count?: number | null;
  last_action_at?: string | null;
}

interface BackendPullRequestDto {
  number: number;
  title?: string | null;
  url?: string | null;
  state?: string | null;
  raw_state?: string | null;
  rawState?: string | null;
  is_draft?: boolean | null;
  isDraft?: boolean | null;
  merged?: boolean | null;
  head_ref?: string | null;
  headRef?: string | null;
  base_ref?: string | null;
  baseRef?: string | null;
  author?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  merged_at?: string | null;
  mergedAt?: string | null;
  checks_state?: string | null;
  checksState?: string | null;
  base_behind_by?: number | null;
  baseBehindBy?: number | null;
  repo?: string | null;
  origin?: string | null;
  pipelines?: BackendPipelineDto[] | null;
  statuses?: BackendStatusDto[] | null;
  conversation?: BackendConversationDto[] | null;
  monitor?: BackendMonitorDto | null;
}

interface BackendPullRequestEnvelope {
  data?: BackendPullRequestDto[] | null;
  supported?: boolean | null;
  available?: boolean | null;
}

const VALID_STATES: readonly PullRequestState[] = ["open", "closed", "merged", "draft", "unknown"];
const VALID_MERGE_METHODS: readonly PullRequestMergeMethod[] = ["merge", "squash", "rebase"];

function normalizeState(value: string | null | undefined): PullRequestState {
  if (typeof value === "string" && (VALID_STATES as readonly string[]).includes(value)) {
    return value as PullRequestState;
  }
  return "unknown";
}

function normalizeJob(dto: BackendJobDto): PullRequestJob {
  return {
    name: dto.name ?? null,
    status: dto.status ?? null,
    conclusion: dto.conclusion ?? null,
    url: dto.url ?? null,
    startedAt: dto.started_at ?? dto.startedAt ?? null,
    completedAt: dto.completed_at ?? dto.completedAt ?? null,
  };
}

function normalizePipeline(dto: BackendPipelineDto): PullRequestPipeline {
  return {
    name: dto.name ?? "Checks",
    url: dto.url ?? null,
    jobs: (dto.jobs ?? []).map(normalizeJob),
  };
}

function normalizeStatus(dto: BackendStatusDto): PullRequestStatusContext {
  return {
    context: dto.context ?? null,
    state: dto.state ?? null,
    url: dto.url ?? null,
    description: dto.description ?? null,
  };
}

function normalizeConversation(dto: BackendConversationDto): PullRequestConversationEntry {
  return {
    author: dto.author ?? null,
    body: dto.body ?? "",
    kind: dto.kind === "review" ? "review" : "comment",
    reviewState: dto.review_state ?? dto.reviewState ?? null,
    createdAt: dto.created_at ?? dto.createdAt ?? null,
  };
}

function normalizeMonitor(dto: BackendMonitorDto | null | undefined): PullRequestMonitorInfo | null {
  if (!dto) return null;
  return {
    lastAction: dto.last_action ?? null,
    summary: dto.summary ?? null,
    autoReworkCount: dto.auto_rework_count ?? 0,
    lastActionAt: dto.last_action_at ?? null,
  };
}

export function normalizePullRequest(dto: BackendPullRequestDto): PullRequest {
  return {
    number: dto.number,
    title: dto.title ?? null,
    url: dto.url ?? null,
    state: normalizeState(dto.state),
    repo: dto.repo ?? null,
    origin: dto.origin === "manual" ? "manual" : "auto",
    rawState: dto.raw_state ?? dto.rawState ?? null,
    isDraft: dto.is_draft ?? dto.isDraft ?? false,
    merged: dto.merged ?? false,
    headRef: dto.head_ref ?? dto.headRef ?? null,
    baseRef: dto.base_ref ?? dto.baseRef ?? null,
    author: dto.author ?? null,
    createdAt: dto.created_at ?? dto.createdAt ?? null,
    updatedAt: dto.updated_at ?? dto.updatedAt ?? null,
    mergedAt: dto.merged_at ?? dto.mergedAt ?? null,
    checksState: dto.checks_state ?? dto.checksState ?? null,
    pipelines: (dto.pipelines ?? []).map(normalizePipeline),
    statuses: (dto.statuses ?? []).map(normalizeStatus),
    conversation: (dto.conversation ?? []).map(normalizeConversation),
    baseBehindBy: dto.base_behind_by ?? dto.baseBehindBy ?? null,
    monitor: normalizeMonitor(dto.monitor),
  };
}

export async function listPullRequests(
  projectSlug: string,
  identifier: string,
  options?: { refresh?: boolean },
): Promise<PullRequestResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");

  const response = await http.get<BackendPullRequestEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests`,
    ),
    options?.refresh ? { params: { refresh: "1" } } : undefined,
  );

  const body = response.data ?? {};
  return {
    data: (body.data ?? []).map(normalizePullRequest),
    supported: body.supported ?? false,
    available: body.available ?? false,
  };
}

export async function linkPullRequest(
  projectSlug: string,
  identifier: string,
  url: string,
): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!url.trim()) throw new Error("url is required");

  await http.post(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/link`,
    ),
    { url: url.trim() },
  );
}

export async function unlinkPullRequest(
  projectSlug: string,
  identifier: string,
  url: string,
): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!url.trim()) throw new Error("url is required");

  await http.delete(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/link`,
    ),
    { data: { url: url.trim() } },
  );
}

interface BackendFixEnvelope {
  data?: {
    moved_to?: string | null;
    comment_posted?: boolean | null;
    jobs?: { name?: string | null; conclusion?: string | null; url?: string | null }[] | null;
  } | null;
}

export async function requestPullRequestFix(
  projectSlug: string,
  identifier: string,
): Promise<PullRequestFixResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");

  const response = await http.post<BackendFixEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/fix`,
    ),
  );

  const data = response.data?.data ?? {};
  return {
    movedTo: data.moved_to ?? "Rework",
    commentPosted: data.comment_posted ?? false,
    jobs: (data.jobs ?? []).map((job) => ({
      name: job.name ?? null,
      conclusion: job.conclusion ?? null,
      url: job.url ?? null,
    })),
  };
}

interface BackendUpdateBranchEnvelope {
  data?: { updated?: boolean | null } | null;
}

export async function updatePullRequestBranch(
  projectSlug: string,
  identifier: string,
  number: number,
): Promise<UpdateBranchResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!Number.isInteger(number) || number <= 0) throw new Error("number is required");

  const response = await http.post<BackendUpdateBranchEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/${number}/update_branch`,
    ),
  );

  return { updated: response.data?.data?.updated ?? false };
}

interface BackendMergeEnvelope {
  data?: {
    merged?: boolean | null;
    method?: string | null;
    bypass?: boolean | null;
    sha?: string | null;
    message?: string | null;
    issue?: BackendIssueDto | null;
  } | null;
}

export async function mergePullRequest(
  projectSlug: string,
  identifier: string,
  number: number,
  input: MergePullRequestInput,
): Promise<MergePullRequestResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!Number.isInteger(number) || number <= 0) throw new Error("number is required");
  if (!isMergeMethod(input.method)) throw new Error("method is required");

  const payload = { method: input.method, bypass: input.bypass === true };
  const response = await http.post<BackendMergeEnvelope>(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/${number}/merge`),
    payload,
  );

  const data = response.data?.data ?? {};
  const method = isMergeMethod(data.method) ? data.method : input.method;
  const result: MergePullRequestResult = {
    merged: data.merged === true,
    method,
    bypass: data.bypass === true,
    issue: data.issue ? normalizeIssue(data.issue) : null,
  };
  if (data.sha) result.sha = data.sha;
  if (data.message) result.message = data.message;
  return result;
}

function isMergeMethod(value: unknown): value is PullRequestMergeMethod {
  return typeof value === "string" && (VALID_MERGE_METHODS as readonly string[]).includes(value);
}

interface BackendRerunEnvelope {
  data?: {
    reruns?: { run_id?: number | null; ok?: boolean | null; error?: string | null; status?: number | null }[] | null;
  } | null;
}

export async function rerunFailedJobs(
  projectSlug: string,
  identifier: string,
  number: number,
): Promise<RerunResult[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!Number.isInteger(number) || number <= 0) throw new Error("number is required");

  const response = await http.post<BackendRerunEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/${number}/rerun_failed`,
    ),
  );

  return (response.data?.data?.reruns ?? []).map((entry) => ({
    runId: entry.run_id ?? 0,
    ok: entry.ok === true,
    ...(entry.error ? { error: entry.error } : {}),
    ...(typeof entry.status === "number" ? { status: entry.status } : {}),
  }));
}
