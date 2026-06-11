import type {
  AgentExecution,
  AgentExecutionGoal,
  AgentExecutionGoalKind,
  AgentExecutionGoalSource,
  AgentExecutionStatus,
} from "@/types/agent-execution";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

import { http, trackerPath, unwrapData } from "./http";

interface BackendAgentExecutionTokensDto {
  input?: number | null;
  output?: number | null;
  total?: number | null;
}

export interface BackendAgentExecutionDto {
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
  agent_kind?: string | null;
  agentKind?: string | null;
  status?: string | null;
  session_id?: string | null;
  sessionId?: string | null;
  last_event?: string | null;
  lastEvent?: string | null;
  last_message?: string | null;
  lastMessage?: string | null;
  last_event_at?: string | null;
  lastEventAt?: string | null;
  turn_count?: number | null;
  turnCount?: number | null;
  runtime_seconds?: number | null;
  runtimeSeconds?: number | null;
  started_at?: string | null;
  startedAt?: string | null;
  retry_attempt?: number | null;
  retryAttempt?: number | null;
  error?: string | null;
  goal?: Record<string, unknown> | null;
  long_running?: boolean | null;
  longRunning?: boolean | null;
  long_running_kind?: string | null;
  longRunningKind?: string | null;
  long_running_label?: string | null;
  longRunningLabel?: string | null;
  tokens?: BackendAgentExecutionTokensDto | null;
}

const KNOWN_STATUSES: readonly AgentExecutionStatus[] = ["live", "idle", "waiting", "retrying"];

function normalizeStatus(status: string | null | undefined): AgentExecutionStatus {
  return KNOWN_STATUSES.includes(status as AgentExecutionStatus) ? (status as AgentExecutionStatus) : "idle";
}

function normalizeAgentKind(kind: string | null | undefined): "codex" | "claude" | null {
  if (kind === "codex" || kind === "claude") return kind;
  return null;
}

function normalizeGoalKind(kind: unknown): AgentExecutionGoalKind | null {
  return kind === "goal" || kind === "workflow" ? kind : null;
}

function normalizeGoalSource(source: unknown): AgentExecutionGoalSource | null {
  return source === "native" || source === "prompt" ? source : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeGoal(goal: Record<string, unknown> | null | undefined): AgentExecutionGoal | null {
  if (!goal) return null;
  const kind = normalizeGoalKind(goal.kind);
  const source = normalizeGoalSource(goal.source);
  if (!kind || !source) return null;

  return {
    kind,
    source,
    objective: stringValue(goal.objective),
    status: stringValue(goal.status),
    capabilities: stringArrayValue(goal.capabilities),
    tokenBudget: numberValue(goal.tokenBudget ?? goal.token_budget),
    tokensUsed: numberValue(goal.tokensUsed ?? goal.tokens_used),
    timeUsedSeconds: numberValue(goal.timeUsedSeconds ?? goal.time_used_seconds),
    updatedAt: numberValue(goal.updatedAt ?? goal.updated_at),
  };
}

export function normalizeAgentExecution(dto: BackendAgentExecutionDto): AgentExecution {
  const tokens = dto.tokens
    ? {
        input: dto.tokens.input ?? 0,
        output: dto.tokens.output ?? 0,
        total: dto.tokens.total ?? 0,
      }
    : null;

  const goal = normalizeGoal(dto.goal);
  const longRunningKind = normalizeGoalKind(dto.longRunningKind ?? dto.long_running_kind);

  return {
    issueIdentifier: normalizeIssueIdentifier(dto.issueIdentifier ?? dto.issue_identifier ?? ""),
    status: normalizeStatus(dto.status),
    agentKind: normalizeAgentKind(dto.agentKind ?? dto.agent_kind),
    sessionId: dto.sessionId ?? dto.session_id ?? null,
    lastEvent: dto.lastEvent ?? dto.last_event ?? null,
    lastMessage: dto.lastMessage ?? dto.last_message ?? null,
    lastEventAt: dto.lastEventAt ?? dto.last_event_at ?? null,
    turnCount: dto.turnCount ?? dto.turn_count ?? 0,
    runtimeSeconds: dto.runtimeSeconds ?? dto.runtime_seconds ?? null,
    startedAt: dto.startedAt ?? dto.started_at ?? null,
    retryAttempt: dto.retryAttempt ?? dto.retry_attempt ?? 0,
    error: dto.error ?? null,
    goal,
    longRunning: dto.longRunning ?? dto.long_running ?? goal !== null,
    longRunningKind,
    longRunningLabel: dto.longRunningLabel ?? dto.long_running_label ?? null,
    tokens,
  };
}

export async function listAgentExecutions(): Promise<AgentExecution[]> {
  const response = await http.get(trackerPath("/agent_executions"));
  return unwrapData<BackendAgentExecutionDto[]>(response)
    .map(normalizeAgentExecution)
    .filter((execution) => execution.issueIdentifier.trim() !== "");
}
