import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { emptyProjectSessionGroups, groupProjectSessions, type ProjectSessionGroups } from "@/lib/projectSessions";
import { listIssues } from "@/services/issues";
import { listRecents } from "@/services/recents";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

const RECENT_SESSIONS_LIMIT = 100;

export interface UseProjectSessionsResult {
  groups: ProjectSessionGroups;
  relatedSessions: RecentSession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProjectSessions(projectSlug: string): UseProjectSessionsResult {
  const { executions, refetch: refetchExecutions } = useAgentExecutions();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjectData = useCallback(async () => {
    const slug = projectSlug.trim();
    if (!slug) {
      setIssues([]);
      setRecents([]);
      setIsLoading(false);
      setError("missing-project");
      return;
    }

    setIsLoading(true);
    try {
      const [nextIssues, nextRecents] = await Promise.all([listIssues(slug), listRecents(RECENT_SESSIONS_LIMIT)]);
      setIssues(nextIssues);
      setRecents(nextRecents.filter((session) => session.projectSlug === slug));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "load-failed");
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  const refetch = useCallback(async () => {
    await Promise.all([loadProjectData(), refetchExecutions()]);
  }, [loadProjectData, refetchExecutions]);

  const groups = useMemo(() => {
    if (issues.length === 0 || executions.size === 0) return emptyProjectSessionGroups();
    return groupProjectSessions(executions.values(), issues);
  }, [executions, issues]);

  const relatedSessions = useMemo(
    () =>
      recents.filter((session) => {
        if (session.kind !== "codex" || !session.identifier) return true;
        return !executions.has(session.identifier);
      }),
    [executions, recents],
  );

  return { groups, relatedSessions, isLoading, error, refetch };
}
