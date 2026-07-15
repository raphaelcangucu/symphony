import type { Channel } from "phoenix";

import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { normalizeAgentExecution, type BackendAgentExecutionDto } from "@/services/agentExecutions";
import type { AgentExecution } from "@/types/agent-execution";

export const AGENT_EXECUTIONS_TOPIC = "agent_executions";

export interface AgentExecutionHandlers {
  onSnapshot: (executions: AgentExecution[]) => void;
  onUpsert: (execution: AgentExecution) => void;
  onRemove: (issueIdentifier: string) => void;
}

function executionItems(payload: unknown): BackendAgentExecutionDto[] {
  if (Array.isArray(payload)) return payload as BackendAgentExecutionDto[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as { data?: unknown; executions?: unknown };
  if (Array.isArray(record.data)) return record.data as BackendAgentExecutionDto[];
  if (Array.isArray(record.executions)) return record.executions as BackendAgentExecutionDto[];
  return [];
}

function executionItem(payload: unknown): AgentExecution | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const execution = normalizeAgentExecution(payload as BackendAgentExecutionDto);
  return execution.issueIdentifier ? execution : null;
}

function removedIssueIdentifier(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { issue_identifier?: unknown; issueIdentifier?: unknown };
  const identifier = record.issueIdentifier ?? record.issue_identifier;
  if (typeof identifier !== "string" || identifier.trim() === "") return null;
  return normalizeIssueIdentifier(identifier);
}

export function bindAgentExecutionEvents(channel: Channel, handlers: AgentExecutionHandlers): void {
  channel.on("snapshot", (payload) => {
    handlers.onSnapshot(
      executionItems(payload)
        .map(normalizeAgentExecution)
        .filter((execution) => execution.issueIdentifier !== ""),
    );
  });
  channel.on("upsert", (payload) => {
    const execution = executionItem(payload);
    if (execution) handlers.onUpsert(execution);
  });
  channel.on("remove", (payload) => {
    const issueIdentifier = removedIssueIdentifier(payload);
    if (issueIdentifier) handlers.onRemove(issueIdentifier);
  });
}
