import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import {
  DEFAULT_PROJECT_SESSIONS_LIMIT,
  fetchProjectSessions,
  projectSessionsToRecents,
} from "@/hooks/projectSessionsCache";
import { emptyProjectSessionGroups, groupProjectSessions, type ProjectSessionGroups } from "@/lib/projectSessions";
import { listIssues } from "@/services/issues";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventory } from "@/types/worktrees";

export interface UseProjectSessionsResult {
  groups: ProjectSessionGroups;
  relatedSessions: RecentSession[];
  /** Full project issues, so inline session views can resolve an issue by identifier. */
  issues: Issue[];
  /** Live execution snapshots keyed by issue identifier. */
  executions: ReadonlyMap<string, AgentExecution>;
  /** Working-tree inventory (git + disk state per workspace); null when unavailable. */
  inventory: WorkspaceInventory | null;
  /** Issues/recents still loading — does not include the inventory scan. */
  isLoading: boolean;
  /** Inventory scan still streaming in. */
  isInventoryLoading: boolean;
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
      const [nextIssues, sessionsPage] = await Promise.all([
        listIssues(slug),
        fetchProjectSessions({
          projectSlug: slug,
          limit: DEFAULT_PROJECT_SESSIONS_LIMIT,
          includeArchived: false,
        }),
      ]);
      setIssues(nextIssues);
      setRecents(projectSessionsToRecents(sessionsPage, slug));
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

  return {
    groups,
    relatedSessions,
    issues,
    executions,
    inventory: null,
    isLoading,
    isInventoryLoading: false,
    error,
    refetch,
  };
}
