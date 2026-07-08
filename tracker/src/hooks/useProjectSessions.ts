import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { emptyProjectSessionGroups, groupProjectSessions, type ProjectSessionGroups } from "@/lib/projectSessions";
import { listIssues } from "@/services/issues";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventory } from "@/types/worktrees";

const RECENT_SESSIONS_LIMIT = 100;

export interface UseProjectSessionsResult {
  groups: ProjectSessionGroups;
  relatedSessions: RecentSession[];
  /** Full project issues, so inline session views can resolve an issue by identifier. */
  issues: Issue[];
  /** Live execution snapshots keyed by issue identifier. */
  executions: ReadonlyMap<string, AgentExecution>;
  /** Working-tree inventory (git + disk state per workspace); null while unavailable. */
  inventory: WorkspaceInventory | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProjectSessions(projectSlug: string): UseProjectSessionsResult {
  const { executions, refetch: refetchExecutions } = useAgentExecutions();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [inventory, setInventory] = useState<WorkspaceInventory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjectData = useCallback(async () => {
    const slug = projectSlug.trim();
    if (!slug) {
      setIssues([]);
      setRecents([]);
      setInventory(null);
      setIsLoading(false);
      setError("missing-project");
      return;
    }

    setIsLoading(true);
    try {
      const [nextIssues, nextRecents, nextInventory] = await Promise.all([
        listIssues(slug),
        listRecents(RECENT_SESSIONS_LIMIT),
        // The inventory scan shells out to git/du; a failure must not take the
        // whole page down, so it degrades to null.
        fetchWorkspaceInventory(slug).catch(() => null),
      ]);
      setIssues(nextIssues);
      setRecents(nextRecents.filter((session) => session.projectSlug === slug));
      setInventory(nextInventory);
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

  return { groups, relatedSessions, issues, executions, inventory, isLoading, error, refetch };
}
