import type {
  PullRequest,
  PullRequestConversationEntry,
  PullRequestJob,
  PullRequestPipeline,
  PullRequestResult,
  PullRequestState,
  PullRequestStatusContext,
} from "@/types/pull-request";

import { http, trackerPath } from "./http";

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
  pipelines?: BackendPipelineDto[] | null;
  statuses?: BackendStatusDto[] | null;
  conversation?: BackendConversationDto[] | null;
}

interface BackendPullRequestEnvelope {
  data?: BackendPullRequestDto[] | null;
  supported?: boolean | null;
  available?: boolean | null;
}

const VALID_STATES: readonly PullRequestState[] = ["open", "closed", "merged", "draft", "unknown"];

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

export function normalizePullRequest(dto: BackendPullRequestDto): PullRequest {
  return {
    number: dto.number,
    title: dto.title ?? null,
    url: dto.url ?? null,
    state: normalizeState(dto.state),
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
  };
}

export async function listPullRequests(projectSlug: string, identifier: string): Promise<PullRequestResult> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.get<BackendPullRequestEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/pull_requests`,
    ),
  );

  const body = response.data ?? {};
  return {
    data: (body.data ?? []).map(normalizePullRequest),
    supported: body.supported ?? false,
    available: body.available ?? false,
  };
}
