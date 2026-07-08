import { useCallback, useEffect, useMemo, useState } from "react";

import { sessionBucketFor, type ProjectSessionRow } from "@/lib/projectSessions";
import { listAssistantThreads } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

export interface UseIssueSessionsResult {
  executionSession: ProjectSessionRow | null;
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
  const [chatSessions, setChatSessions] = useState<AssistantThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);

  const load = useCallback(async () => {
    const slug = projectSlug.trim();
    if (!slug || !issue.identifier.trim()) {
      setChatSessions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const threads = await listAssistantThreads({
        projectSlug: slug,
        issueIdentifier: issue.identifier,
        scopes: ["issue_session", "issue"],
      });
      setChatSessions(threads);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "load-failed");
      setChatSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [issue.identifier, projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const executionSession = useMemo((): ProjectSessionRow | null => {
    if (!execution) return null;
    const bucket = sessionBucketFor(execution.status);
    return {
      issueIdentifier: issue.identifier,
      title: issue.title,
      agentKind: execution.agentKind,
      status: execution.status,
      bucket,
      lastEventAt: execution.lastEventAt,
      turnCount: execution.turnCount,
      runtimeSeconds: execution.runtimeSeconds,
      startedAt: execution.startedAt,
      goalObjective: execution.goal?.objective ?? null,
      execution,
    };
  }, [execution, issue.identifier, issue.title]);

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
    chatSessions,
    isLoading,
    error,
    resumePending,
    refetch: load,
    resumeExecution,
  };
}
