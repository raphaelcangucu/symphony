import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";

function hasInterruptedSignals(execution: AgentExecution): boolean {
  if (execution.error?.trim()) return true;
  const event = execution.lastEvent?.toLowerCase() ?? "";
  return event.includes("aborted") || event === "turn_aborted";
}

/** Single display status for board cards and execution detail. */
export function resolveDisplayStatus(execution: AgentExecution): AgentExecutionStatus {
  if (execution.status === "aborted" || execution.status === "error") return execution.status;
  if (hasInterruptedSignals(execution)) return "aborted";
  return execution.status;
}

export function reconcileExecutionStatus(execution: AgentExecution): AgentExecution {
  const status = resolveDisplayStatus(execution);
  if (status === execution.status) return execution;
  return { ...execution, status };
}

export function isActiveAgentRun(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "live" || status === "waiting" || status === "idle";
}

export function canResumeExecution(execution?: AgentExecution): boolean {
  if (!execution) return true;
  return !isActiveAgentRun(execution);
}

export function canSteerExecution(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "live" || status === "waiting";
}

export function executionNeedsAttention(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "aborted" || status === "error";
}
