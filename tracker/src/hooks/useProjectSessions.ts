import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { emptyProjectSessionGroups, groupProjectSessions, type ProjectSessionGroups } from "@/lib/projectSessions";
import { listIssues } from "@/services/issues";
import { listRecents } from "@/services/recents";
import {
  fetchWorkspaceInventory,
  subscribeWorkspaceInventory,
} from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventory, WorkspaceInventoryEntry } from "@/types/worktrees";

const RECENT_SESSIONS_LIMIT = 100;

const EMPTY_INVENTORY_TOTALS: WorkspaceInventory["totals"] = {
  count: 0,
  sizeBytes: 0,
  reclaimableBytes: 0,
};

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

function upsertInventoryEntry(
  entries: WorkspaceInventoryEntry[],
  entry: WorkspaceInventoryEntry,
): WorkspaceInventoryEntry[] {
  const index = entries.findIndex((candidate) => candidate.path === entry.path);
  if (index < 0) {
    return [...entries, entry];
  }

  const next = [...entries];
  next[index] = entry;
  return next;
}

function provisionalTotals(entries: readonly WorkspaceInventoryEntry[]): WorkspaceInventory["totals"] {
  return {
    count: entries.length,
    sizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    reclaimableBytes: entries
      .filter((entry) => entry.reclaimable)
      .reduce((sum, entry) => sum + entry.sizeBytes, 0),
  };
}

export function useProjectSessions(projectSlug: string): UseProjectSessionsResult {
  const { executions, refetch: refetchExecutions } = useAgentExecutions();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [inventory, setInventory] = useState<WorkspaceInventory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInventoryLoading, setIsInventoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0);
  const inventoryGenerationRef = useRef(0);
  const fallbackStartedRef = useRef(false);

  const loadProjectData = useCallback(async () => {
    const slug = projectSlug.trim();
    if (!slug) {
      setIssues([]);
      setRecents([]);
      setInventory(null);
      setIsLoading(false);
      setIsInventoryLoading(false);
      setError("missing-project");
      return;
    }

    setIsLoading(true);
    try {
      const [nextIssues, nextRecents] = await Promise.all([
        listIssues(slug),
        listRecents(RECENT_SESSIONS_LIMIT),
      ]);
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

  useEffect(() => {
    const slug = projectSlug.trim();
    if (!slug) {
      return undefined;
    }

    const generation = ++inventoryGenerationRef.current;
    fallbackStartedRef.current = false;
    setIsInventoryLoading(true);
    setInventory({ entries: [], totals: EMPTY_INVENTORY_TOTALS });

    const applyEntry = (entry: WorkspaceInventoryEntry) => {
      if (generation !== inventoryGenerationRef.current || fallbackStartedRef.current) {
        return;
      }

      setInventory((current) => {
        const entries = upsertInventoryEntry(current?.entries ?? [], entry);
        return {
          entries,
          totals: provisionalTotals(entries),
        };
      });
    };

    const finishInventory = () => {
      if (generation !== inventoryGenerationRef.current || fallbackStartedRef.current) {
        return;
      }

      setIsInventoryLoading(false);
    };

    const loadInventoryFallback = () => {
      if (generation !== inventoryGenerationRef.current || fallbackStartedRef.current) {
        return;
      }

      fallbackStartedRef.current = true;

      void fetchWorkspaceInventory(slug)
        .then((nextInventory) => {
          if (generation !== inventoryGenerationRef.current) {
            return;
          }

          setInventory(nextInventory);
          setIsInventoryLoading(false);
        })
        .catch(() => {
          if (generation !== inventoryGenerationRef.current) {
            return;
          }

          setInventory(null);
          setIsInventoryLoading(false);
        });
    };

    const unsubscribe = subscribeWorkspaceInventory(slug, {
      onEntry: applyEntry,
      onTotals: (totals) => {
        if (generation !== inventoryGenerationRef.current || fallbackStartedRef.current) {
          return;
        }

        setInventory((current) => ({
          entries: current?.entries ?? [],
          totals,
        }));
      },
      onDone: finishInventory,
      onError: () => {
        if (generation !== inventoryGenerationRef.current || fallbackStartedRef.current) {
          return;
        }

        loadInventoryFallback();
      },
    });

    return unsubscribe;
  }, [inventoryRefreshKey, projectSlug]);

  const refetch = useCallback(async () => {
    await Promise.all([loadProjectData(), refetchExecutions()]);
    setInventoryRefreshKey((current) => current + 1);
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
    inventory,
    isLoading,
    isInventoryLoading,
    error,
    refetch,
  };
}
