import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useViewer } from "@/components/auth/ViewerProvider";
import {
  buildBoardState,
  findIssueStatus,
  flattenBoardState,
  moveIssueLocally,
} from "@/components/board/board-utils";
import type { IssueFilters } from "@/lib/issueFilters";
import { applyIssueFilters } from "@/lib/issueFilters";
import { listIssues, moveIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { useProjectChannel } from "./useProjectChannel";

export interface UseIssueBoardResult {
  issues: Issue[];
  filteredIssues: Issue[];
  board: ReturnType<typeof buildBoardState>;
  /** True only while the first load is in flight. Background refreshes never set this. */
  loading: boolean;
  /** True while a silent background refresh (poll / realtime / manual) is in flight. */
  refreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  moveIssueOptimistically: (identifier: string, status: WorkflowStatusName, position: number) => Promise<void>;
  setIssues: React.Dispatch<React.SetStateAction<Issue[]>>;
}

function upsertIssue(issues: Issue[], issue: Issue): Issue[] {
  const index = issues.findIndex((item) => item.identifier === issue.identifier);
  if (index === -1) return [...issues, issue];
  return issues.map((item, itemIndex) => (itemIndex === index ? issue : item));
}

export function useIssueBoard(
  projectSlug: string,
  filters: IssueFilters = {},
  statuses?: WorkflowStatusName[],
): UseIssueBoardResult {
  const { viewer } = useViewer();
  const viewerLogin = viewer?.githubLogin ?? null;
  const { search, assignee, creator } = filters;

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!projectSlug.trim()) return;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setIssues(await listIssues(projectSlug, { search, assignee, creator }));
      hasLoadedRef.current = true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to load issues";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectSlug, search, assignee, creator]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setLoading(true);
  }, [projectSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const filteredIssues = useMemo(
    () => applyIssueFilters(issues, { search, assignee, creator }, viewerLogin),
    [issues, search, assignee, creator, viewerLogin],
  );

  const board = useMemo(() => buildBoardState(filteredIssues, statuses), [filteredIssues, statuses]);

  const moveIssueOptimistically = useCallback(
    async (identifier: string, status: WorkflowStatusName, position: number) => {
      const previousBoard = buildBoardState(issues, statuses);
      const sourceStatus = findIssueStatus(previousBoard, identifier, statuses);
      if (!sourceStatus) return;

      const nextBoard = moveIssueLocally(previousBoard, identifier, status, position, statuses);
      setIssues(flattenBoardState(nextBoard));

      try {
        const persisted = await moveIssue(projectSlug, identifier, { status, position });
        setIssues((current) => upsertIssue(current, persisted));
      } catch (cause) {
        setIssues(flattenBoardState(previousBoard));
        const message = cause instanceof Error ? cause.message : "Failed to move issue";
        toast.error(message);
      }
    },
    [issues, projectSlug, statuses],
  );

  useProjectChannel(projectSlug, (event, payload) => {
    if (event === "issue_moved") {
      void refetch();
      return;
    }

    if (event === "issue_created" || event === "issue_updated") {
      const issuePayload = payload as { issue: Issue };
      setIssues((current) => upsertIssue(current, issuePayload.issue));
      return;
    }
    void refetch();
  });

  return { issues, filteredIssues, board, loading, refreshing, error, refetch, moveIssueOptimistically, setIssues };
}
