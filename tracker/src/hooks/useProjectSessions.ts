import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useRecents } from "@/hooks/useRecents";
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
  const { executions } = useAgentExecutions();
  const { sessions: recents, loading: recentsLoading } = useRecents();
  const normalizedProjectSlug = projectSlug.trim();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjectData = useCallback(async () => {
    const slug = normalizedProjectSlug;
    if (!slug) {
      setIssues([]);
      setIsLoading(false);
      setError("missing-project");
      return;
    }

    setIsLoading(true);
    try {
      setIssues(await listIssues(slug));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "load-failed");
    } finally {
      setIsLoading(false);
    }
  }, [normalizedProjectSlug]);

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  const refetch = useCallback(async () => {
    await loadProjectData();
  }, [loadProjectData]);

  const groups = useMemo(() => {
    if (issues.length === 0 || executions.size === 0) return emptyProjectSessionGroups();
    return groupProjectSessions(executions.values(), issues);
  }, [executions, issues]);

  const relatedSessions = useMemo(
    () =>
      recents.filter((session) => {
        if (session.projectSlug !== normalizedProjectSlug) return false;
        if (session.kind !== "codex" || !session.identifier) return true;
        return !executions.has(session.identifier);
      }),
    [executions, normalizedProjectSlug, recents],
  );

  return {
    groups,
    relatedSessions,
    issues,
    executions,
    inventory: null,
    isLoading: isLoading || recentsLoading,
    isInventoryLoading: false,
    error,
    refetch,
  };
}
