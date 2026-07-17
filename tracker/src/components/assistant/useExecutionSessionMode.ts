import { useMemo } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useSessionLogChannel, type AgentSteerPayload } from "@/hooks/useSessionLogChannel";
import { canSteerExecution, isActiveAgentRun } from "@/lib/agentExecutionDisplay";
import {
  adaptSessionLogEntries,
  deriveAgentTasksFromSessionLog,
  type SessionLogFeedItem,
} from "@/lib/sessionLogFeed";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { SessionLogEntry } from "@/types/session-log";

export interface UseExecutionSessionModeArgs {
  projectSlug: string;
  threadId: number | null | undefined;
  issueIdentifier: string | null | undefined;
  enabled: boolean;
  agentKind?: string | null;
}

export interface UseExecutionSessionModeResult {
  entries: SessionLogEntry[];
  feedItems: SessionLogFeedItem[];
  taskSnapshot: AgentTaskSnapshot | null;
  execution: AgentExecution | undefined;
  executions: AgentExecution[];
  connected: boolean;
  error: string | null;
  canSteer: boolean;
  isActive: boolean;
  steerTurn: (payload: AgentSteerPayload) => void;
  steerPending: boolean;
  steerError: string | null;
  logAgentKind: string | null;
  preferredAgentKind: string | null;
}

/**
 * Session-log body + execution facts for issue_execution threads.
 * Does not touch the assistant channel (no send_message / history).
 */
export function useExecutionSessionMode({
  projectSlug,
  threadId,
  issueIdentifier,
  enabled,
  agentKind = null,
}: UseExecutionSessionModeArgs): UseExecutionSessionModeResult {
  const identifier = issueIdentifier?.trim() || null;
  const { executions: executionMap } = useAgentExecutions({ enabled });
  const execution = identifier ? executionMap.get(identifier) : undefined;

  // Prefer the thread id (canonical session); fall back to the live execution
  // session id when metadata has not yet stamped executionSessionId.
  const sessionId = threadId ?? execution?.executionSessionId ?? null;

  const sessionLog = useSessionLogChannel({
    projectSlug,
    sessionId,
    issueIdentifier: identifier,
    enabled: enabled && Boolean(projectSlug.trim()) && sessionId != null,
    agentKind: agentKind ?? execution?.agentKind ?? null,
  });

  const feedItems = useMemo(
    () => (enabled ? adaptSessionLogEntries(sessionLog.entries) : []),
    [enabled, sessionLog.entries],
  );

  const taskSnapshot = useMemo(
    () => (enabled ? deriveAgentTasksFromSessionLog(sessionLog.entries) : null),
    [enabled, sessionLog.entries],
  );

  const executions = useMemo(() => {
    if (!enabled) return [];
    if (execution) return [execution];
    return [];
  }, [enabled, execution]);

  const canSteer = enabled && canSteerExecution(execution);
  const isActive = enabled && isActiveAgentRun(execution);

  return {
    entries: enabled ? sessionLog.entries : [],
    feedItems,
    taskSnapshot,
    execution,
    executions,
    connected: sessionLog.connected,
    error: sessionLog.error,
    canSteer,
    isActive,
    steerTurn: sessionLog.steerTurn,
    steerPending: sessionLog.steerPending,
    steerError: sessionLog.steerError,
    logAgentKind: sessionLog.logAgentKind,
    preferredAgentKind: sessionLog.preferredAgentKind,
  };
}
