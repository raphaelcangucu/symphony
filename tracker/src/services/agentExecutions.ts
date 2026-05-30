import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
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
  tokens?: BackendAgentExecutionTokensDto | null;
}

const KNOWN_STATUSES: readonly AgentExecutionStatus[] = ["live", "idle", "waiting", "retrying"];

function normalizeStatus(status: string | null | undefined): AgentExecutionStatus {
  return KNOWN_STATUSES.includes(status as AgentExecutionStatus) ? (status as AgentExecutionStatus) : "idle";
}

export function normalizeAgentExecution(dto: BackendAgentExecutionDto): AgentExecution {
  const tokens = dto.tokens
    ? {
        input: dto.tokens.input ?? 0,
        output: dto.tokens.output ?? 0,
        total: dto.tokens.total ?? 0,
      }
    : null;

  return {
    issueIdentifier: normalizeIssueIdentifier(dto.issueIdentifier ?? dto.issue_identifier ?? ""),
    status: normalizeStatus(dto.status),
    sessionId: dto.sessionId ?? dto.session_id ?? null,
    lastEvent: dto.lastEvent ?? dto.last_event ?? null,
    lastMessage: dto.lastMessage ?? dto.last_message ?? null,
    lastEventAt: dto.lastEventAt ?? dto.last_event_at ?? null,
    turnCount: dto.turnCount ?? dto.turn_count ?? 0,
    runtimeSeconds: dto.runtimeSeconds ?? dto.runtime_seconds ?? null,
    startedAt: dto.startedAt ?? dto.started_at ?? null,
    retryAttempt: dto.retryAttempt ?? dto.retry_attempt ?? 0,
    error: dto.error ?? null,
    tokens,
  };
}

export async function listAgentExecutions(): Promise<AgentExecution[]> {
  const response = await http.get(trackerPath("/agent_executions"));
  return unwrapData<BackendAgentExecutionDto[]>(response)
    .map(normalizeAgentExecution)
    .filter((execution) => execution.issueIdentifier.trim() !== "");
}
