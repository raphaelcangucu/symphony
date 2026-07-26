export type OrchestratorExecutionStatus =
  | "live"
  | "idle"
  | "waiting"
  | "retrying"
  | "error"
  | "aborted"
  | "paused"
  | "saved";

export type OrchestratorExecution = {
  issueIdentifier: string;
  executionSessionId: number;
  status: OrchestratorExecutionStatus;
  agentKind: "codex" | "claude" | "cursor" | "opencode" | null;
  model: string | null;
  lastMessage: string | null;
  lastEventAt: string | null;
  turnCount: number;
};

export function normalizeExecutionPayload(payload: unknown): OrchestratorExecution[] {
  if (!isRecord(payload)) return [];
  const rows = payload.executions ?? payload.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const execution = normalizeExecution(row);
    return execution ? [execution] : [];
  });
}

export function orchestratorRunRoute(
  hostId: string,
  executionSessionId: number,
  issueIdentifier: string,
  agentKind: string | null,
  status: string,
): string {
  return hostWorktreeRoute({
    agentKind,
    hostId,
    issueIdentifier,
    scope: "issue_execution",
    status,
    threadId: executionSessionId,
  });
}

function normalizeExecution(value: unknown): OrchestratorExecution | null {
  if (!isRecord(value)) return null;
  const executionSessionId = value.execution_session_id;
  const issueIdentifier = value.issue_identifier;
  if (
    typeof executionSessionId !== "number" ||
    !Number.isInteger(executionSessionId) ||
    executionSessionId <= 0 ||
    typeof issueIdentifier !== "string" ||
    !issueIdentifier.trim()
  ) {
    return null;
  }
  return {
    issueIdentifier: issueIdentifier.trim(),
    executionSessionId,
    status: normalizeStatus(value.status),
    agentKind: normalizeAgent(value.agent_kind),
    model: nonEmptyString(value.model),
    lastMessage: nonEmptyString(value.last_message),
    lastEventAt: nonEmptyString(value.last_event_at),
    turnCount:
      typeof value.turn_count === "number" && Number.isFinite(value.turn_count)
        ? value.turn_count
        : 0,
  };
}

function normalizeStatus(value: unknown): OrchestratorExecutionStatus {
  return value === "live" ||
    value === "idle" ||
    value === "waiting" ||
    value === "retrying" ||
    value === "error" ||
    value === "aborted" ||
    value === "paused" ||
    value === "saved"
    ? value
    : "idle";
}

function normalizeAgent(value: unknown): OrchestratorExecution["agentKind"] {
  return value === "codex" || value === "claude" || value === "cursor" || value === "opencode"
    ? value
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import { hostWorktreeRoute } from "@/features/sessions/session-navigation";
