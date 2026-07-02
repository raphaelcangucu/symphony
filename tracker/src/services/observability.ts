import type {
  BundleRole,
  PrMonitorEvaluation,
  PrMonitorHeartbeat,
  PrMonitorObservability,
  PrMonitorTickStatus,
  RetryEntry,
  RunningSession,
  RunningSessionStatus,
  RuntimeObservability,
  RuntimeStatus,
} from "@/types/observability";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTokensDto {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
}

interface BackendRunningDto {
  issue_identifier?: string | null;
  state?: string | null;
  status?: string | null;
  session_id?: string | null;
  turn_count?: number | null;
  last_event?: string | null;
  last_message?: string | null;
  started_at?: string | null;
  last_event_at?: string | null;
  tokens?: BackendTokensDto | null;
  parent_identifier?: string | null;
  bundle_role?: string | null;
  unit_id?: string | null;
  repo?: string | null;
  child_identifiers?: string[] | null;
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

function normalizeBundleRole(role: string | null | undefined): BundleRole {
  return role === "parent" || role === "parent_unified" || role === "child" || role === "subagent" ? role : "standalone";
}

function normalizeRunningStatus(status: string | null | undefined): RunningSessionStatus | null {
  return status === "live" || status === "waiting" ? status : null;
}

function normalizeRunning(dto: BackendRunningDto): RunningSession {
  return {
    issueIdentifier: normalizeIssueIdentifier(dto.issue_identifier ?? ""),
    state: dto.state ?? null,
    status: normalizeRunningStatus(dto.status),
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
    parentIdentifier: dto.parent_identifier ? normalizeIssueIdentifier(dto.parent_identifier) : null,
    bundleRole: normalizeBundleRole(dto.bundle_role),
    unitId: dto.unit_id ?? null,
    repo: dto.repo ?? null,
    childIdentifiers: (dto.child_identifiers ?? []).map((id) => normalizeIssueIdentifier(id)),
  };
}

function normalizeRetry(dto: BackendRetryDto): RetryEntry {
  return {
    issueIdentifier: normalizeIssueIdentifier(dto.issue_identifier ?? ""),
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

interface BackendPrMonitorHeartbeatDto {
  running?: boolean | null;
  in_flight?: number | null;
  tick_count?: number | null;
  last_tick_started_at?: string | null;
  last_tick_finished_at?: string | null;
  last_tick_status?: string | null;
  last_error?: string | null;
  last_evaluated_count?: number | null;
  interval_ms?: number | null;
}

interface BackendPrMonitorEvaluationDto {
  project_slug?: string | null;
  identifier?: string | null;
  pr_url?: string | null;
  last_event?: string | null;
  last_action?: string | null;
  auto_rework_count?: number | null;
  summary?: string | null;
  last_checked_at?: string | null;
  last_action_at?: string | null;
}

interface BackendPrMonitorDto {
  heartbeat?: BackendPrMonitorHeartbeatDto | null;
  evaluations?: BackendPrMonitorEvaluationDto[] | null;
}

function normalizeTickStatus(status: string | null | undefined): PrMonitorTickStatus {
  return status === "ok" || status === "error" ? status : null;
}

function normalizeHeartbeat(dto: BackendPrMonitorHeartbeatDto | null | undefined): PrMonitorHeartbeat {
  return {
    running: dto?.running ?? false,
    inFlight: dto?.in_flight ?? 0,
    tickCount: dto?.tick_count ?? 0,
    lastTickStartedAt: dto?.last_tick_started_at ?? null,
    lastTickFinishedAt: dto?.last_tick_finished_at ?? null,
    lastTickStatus: normalizeTickStatus(dto?.last_tick_status),
    lastError: dto?.last_error ?? null,
    lastEvaluatedCount: dto?.last_evaluated_count ?? 0,
    intervalMs: dto?.interval_ms ?? 0,
  };
}

function normalizeEvaluation(dto: BackendPrMonitorEvaluationDto): PrMonitorEvaluation {
  return {
    projectSlug: dto.project_slug ?? null,
    issueIdentifier: normalizeIssueIdentifier(dto.identifier ?? ""),
    prUrl: dto.pr_url ?? null,
    lastEvent: dto.last_event ?? null,
    lastAction: dto.last_action ?? null,
    autoReworkCount: dto.auto_rework_count ?? 0,
    summary: dto.summary ?? null,
    lastCheckedAt: dto.last_checked_at ?? null,
    lastActionAt: dto.last_action_at ?? null,
  };
}

export function normalizePrMonitor(dto: BackendPrMonitorDto): PrMonitorObservability {
  return {
    heartbeat: normalizeHeartbeat(dto.heartbeat),
    evaluations: (dto.evaluations ?? []).map(normalizeEvaluation),
  };
}

export async function getPrMonitorObservability(): Promise<PrMonitorObservability> {
  const response = await http.get(trackerPath("/observability/pr_monitor"));
  return normalizePrMonitor(unwrapData<BackendPrMonitorDto>(response));
}
