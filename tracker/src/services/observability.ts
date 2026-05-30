import type {
  RetryEntry,
  RunningSession,
  RuntimeObservability,
  RuntimeStatus,
} from "@/types/observability";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTokensDto {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
}

interface BackendRunningDto {
  issue_identifier?: string | null;
  state?: string | null;
  session_id?: string | null;
  turn_count?: number | null;
  last_event?: string | null;
  last_message?: string | null;
  started_at?: string | null;
  last_event_at?: string | null;
  tokens?: BackendTokensDto | null;
}

interface BackendRetryDto {
  issue_identifier?: string | null;
  attempt?: number | null;
  due_at?: string | null;
  error?: string | null;
}

export interface BackendRuntimeDto {
  runtime_id?: string | null;
  label?: string | null;
  project_slug?: string | null;
  tracker_kind?: string | null;
  agent_kind?: string | null;
  source_url?: string | null;
  status?: string | null;
  reported_at?: string | null;
  counts?: { running?: number | null; retrying?: number | null } | null;
  agent_totals?: { input_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null; seconds_running?: number | null } | null;
  rate_limits?: unknown | null;
  running?: BackendRunningDto[] | null;
  retrying?: BackendRetryDto[] | null;
}

function normalizeStatus(status: string | null | undefined): RuntimeStatus {
  return status === "stale" ? "stale" : "online";
}

function normalizeRunning(dto: BackendRunningDto): RunningSession {
  return {
    issueIdentifier: dto.issue_identifier ?? "",
    state: dto.state ?? null,
    sessionId: dto.session_id ?? null,
    turnCount: dto.turn_count ?? 0,
    lastEvent: dto.last_event ?? null,
    lastMessage: dto.last_message ?? null,
    startedAt: dto.started_at ?? null,
    lastEventAt: dto.last_event_at ?? null,
    tokens: {
      inputTokens: dto.tokens?.input_tokens ?? 0,
      outputTokens: dto.tokens?.output_tokens ?? 0,
      totalTokens: dto.tokens?.total_tokens ?? 0,
    },
  };
}

function normalizeRetry(dto: BackendRetryDto): RetryEntry {
  return {
    issueIdentifier: dto.issue_identifier ?? "",
    attempt: dto.attempt ?? 0,
    dueAt: dto.due_at ?? null,
    error: dto.error ?? null,
  };
}

export function normalizeRuntime(dto: BackendRuntimeDto): RuntimeObservability {
  return {
    runtimeId: dto.runtime_id ?? "",
    label: dto.label ?? dto.project_slug ?? dto.runtime_id ?? "unknown",
    projectSlug: dto.project_slug ?? null,
    trackerKind: dto.tracker_kind ?? null,
    agentKind: dto.agent_kind ?? null,
    sourceUrl: dto.source_url ?? null,
    status: normalizeStatus(dto.status),
    reportedAt: dto.reported_at ?? "",
    counts: { running: dto.counts?.running ?? 0, retrying: dto.counts?.retrying ?? 0 },
    agentTotals: {
      inputTokens: dto.agent_totals?.input_tokens ?? 0,
      outputTokens: dto.agent_totals?.output_tokens ?? 0,
      totalTokens: dto.agent_totals?.total_tokens ?? 0,
      secondsRunning: dto.agent_totals?.seconds_running ?? 0,
    },
    rateLimits: dto.rate_limits ?? null,
    running: (dto.running ?? []).map(normalizeRunning),
    retrying: (dto.retrying ?? []).map(normalizeRetry),
  };
}

export async function listObservability(): Promise<RuntimeObservability[]> {
  const response = await http.get(trackerPath("/observability"));
  return unwrapData<BackendRuntimeDto[]>(response).map(normalizeRuntime);
}
