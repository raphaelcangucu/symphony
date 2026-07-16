import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { DEFAULT_PROJECT_SESSIONS_LIMIT, fetchProjectSessions } from "@/hooks/projectSessionsCache";
import { useRecents } from "@/hooks/useRecents";
import {
  emptyProjectSessionGroups,
  groupProjectSessions,
  mergeExecutionsFromSessionRows,
  type ProjectSessionGroups,
} from "@/lib/projectSessions";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { ProjectSessionRow } from "@/types/project-session";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventory } from "@/types/worktrees";

export interface UseProjectSessionsResult {
  groups: ProjectSessionGroups;
  relatedSessions: RecentSession[];
  /** Lightweight issue records derived from the limited sessions response. */
  issues: readonly Issue[];
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
  const [sessions, setSessions] = useState<readonly ProjectSessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjectData = useCallback(async () => {
    const slug = normalizedProjectSlug;
    if (!slug) {
      setSessions([]);
      setIsLoading(false);
      setError("missing-project");
      return;
    }

    setIsLoading(true);
    try {
      const page = await fetchProjectSessions({
        projectSlug: slug,
        limit: DEFAULT_PROJECT_SESSIONS_LIMIT,
        includeArchived: false,
      });
      setSessions(page.sessions);
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

  const issues = useMemo((): readonly Issue[] => {
    const issuesByIdentifier = new Map<string, Issue>();
    for (const session of sessions) {
      const identifier = session.issueIdentifier?.trim();
      const title = session.title.trim();
      if (!identifier || !title || issuesByIdentifier.has(identifier)) continue;
      issuesByIdentifier.set(identifier, {
        id: identifier,
        identifier,
        projectSlug: normalizedProjectSlug,
        status: "Todo",
        title,
        description: null,
        priority: null,
        position: 0,
        labels: [],
        blockedBy: [],
        assignee: null,
        creator: null,
        url: null,
        branchName: null,
        createdAt: session.updatedAt,
        updatedAt: session.updatedAt,
        attachments: [],
      });
    }
    return [...issuesByIdentifier.values()];
  }, [normalizedProjectSlug, sessions]);

  const mergedExecutions = useMemo(
    () => mergeExecutionsFromSessionRows(executions, sessions),
    [executions, sessions],
  );

  const groups = useMemo(() => {
    if (issues.length === 0 || mergedExecutions.size === 0) return emptyProjectSessionGroups();
    return groupProjectSessions(mergedExecutions.values(), issues);
  }, [issues, mergedExecutions]);

  const relatedSessions = useMemo(
    () =>
      recents.filter((session) => {
        if (session.projectSlug !== normalizedProjectSlug) return false;
        if (session.kind !== "codex" || !session.identifier) return true;
        return !mergedExecutions.has(session.identifier);
      }),
    [mergedExecutions, normalizedProjectSlug, recents],
  );

  return {
    groups,
    relatedSessions,
    issues,
    executions: mergedExecutions,
    inventory: null,
    isLoading: isLoading || recentsLoading,
    isInventoryLoading: false,
    error,
    refetch,
  };
}
