import { useCallback, useEffect, useMemo, useState } from "react";

import { sessionBucketFor, type ProjectSessionRow } from "@/lib/projectSessions";
import { listAssistantThreads } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const CHAT_SCOPES = new Set(["issue_session", "issue"]);
const ISSUE_SESSION_SCOPES = ["issue_session", "issue", "issue_execution"] as const;

export interface UseIssueSessionsResult {
  /** Primary/latest execution row (live snapshot preferred). */
  executionSession: ProjectSessionRow | null;
  /** All orchestrator execution sessions for this issue (persisted + live). */
  executionSessions: ProjectSessionRow[];
  chatSessions: AssistantThread[];
  isLoading: boolean;
  error: string | null;
  resumePending: boolean;
  refetch: () => Promise<void>;
  resumeExecution: () => Promise<void>;
}

export function useIssueSessions(
  projectSlug: string,
  issue: Pick<Issue, "identifier" | "title">,
  execution?: AgentExecution,
): UseIssueSessionsResult {
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);

  const load = useCallback(async () => {
    const slug = projectSlug.trim();
    if (!slug || !issue.identifier.trim()) {
      setThreads([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const next = await listAssistantThreads({
        projectSlug: slug,
        issueIdentifier: issue.identifier,
        scopes: [...ISSUE_SESSION_SCOPES],
      });
      setThreads(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "load-failed");
      setThreads([]);
    } finally {
      setIsLoading(false);
    }
  }, [issue.identifier, projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const chatSessions = useMemo(
    () => threads.filter((thread) => CHAT_SCOPES.has(thread.scope)),
    [threads],
  );

  const executionSessions = useMemo(
    () => buildExecutionSessions(issue, threads, execution),
    [execution, issue, threads],
  );

  const executionSession = executionSessions[0] ?? null;

  const resumeExecution = useCallback(async () => {
    if (resumePending) return;
    setResumePending(true);
    try {
      await dispatchIssueAgent(projectSlug, issue.identifier, { action: "resume" });
    } finally {
      setResumePending(false);
    }
  }, [issue.identifier, projectSlug, resumePending]);

  return {
    executionSession,
    executionSessions,
    chatSessions,
    isLoading,
    error,
    resumePending,
    refetch: load,
    resumeExecution,
  };
}

function buildExecutionSessions(
  issue: Pick<Issue, "identifier" | "title">,
  threads: readonly AssistantThread[],
  live?: AgentExecution,
): ProjectSessionRow[] {
  const executionThreads = threads
    .filter((thread) => thread.scope === "issue_execution")
    .slice()
    .sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));

  const rows: ProjectSessionRow[] = [];
  const seenIds = new Set<number>();

  for (const thread of executionThreads) {
    const matchedLive =
      live && live.executionSessionId != null && live.executionSessionId === thread.id
        ? live
        : undefined;
    const row = matchedLive
      ? rowFromLiveExecution(issue, matchedLive, thread)
      : rowFromExecutionThread(issue, thread);
    rows.push(row);
    seenIds.add(thread.id);
  }

  // Live run whose thread has not been returned yet (race after dispatch).
  if (live && live.executionSessionId != null && live.executionSessionId > 0) {
    if (!seenIds.has(live.executionSessionId)) {
      rows.unshift(rowFromLiveExecution(issue, live));
    }
  } else if (live && rows.length === 0) {
    // Legacy live snapshot without a session id — keep previous behavior.
    rows.push(rowFromLiveExecution(issue, live));
  }

  return rows;
}

function rowFromLiveExecution(
  issue: Pick<Issue, "identifier" | "title">,
  execution: AgentExecution,
  thread?: AssistantThread,
): ProjectSessionRow {
  const bucket = sessionBucketFor(execution.status);
  return {
    issueIdentifier: issue.identifier,
    title: thread?.title?.trim() || issue.title,
    agentKind: execution.agentKind ?? thread?.agentKind ?? null,
    status: execution.status,
    bucket,
    lastEventAt: execution.lastEventAt,
    turnCount: execution.turnCount,
    runtimeSeconds: execution.runtimeSeconds,
    startedAt: execution.startedAt,
    goalObjective: execution.goal?.objective ?? null,
    execution,
  };
}

function rowFromExecutionThread(
  issue: Pick<Issue, "identifier" | "title">,
  thread: AssistantThread,
): ProjectSessionRow {
  const execution = syntheticExecutionFromThread(issue.identifier, thread);
  const bucket = sessionBucketFor(execution.status);
  return {
    issueIdentifier: issue.identifier,
    title: thread.title?.trim() || issue.title,
    agentKind: thread.agentKind,
    status: execution.status,
    bucket,
    lastEventAt: thread.updatedAt,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: thread.updatedAt,
    goalObjective: null,
    execution,
  };
}

function syntheticExecutionFromThread(
  issueIdentifier: string,
  thread: AssistantThread,
): AgentExecution {
  // Thread.status "active" means the chat row is not archived — not that the
  // agent is currently running. Without a live orchestrator snapshot, treat
  // persisted runs as idle so Resume remains available.
  return {
    issueIdentifier,
    status: "idle",
    agentKind: thread.agentKind,
    sessionId: String(thread.id),
    executionSessionId: thread.id,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: thread.updatedAt,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: thread.updatedAt,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
  };
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
