import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  buildBoardState,
  findIssueStatus,
  flattenBoardState,
  moveGroupLocally,
  resolveMoveUnit,
  upsertIssue,
} from "@/components/board/board-utils";
import type { IssueFilters } from "@/lib/issueFilters";
import { applyIssueFilters, emptyFilters } from "@/lib/issueFilters";
import { i18n } from "@/i18n";
import { groupIssue, listIssues, moveIssue, ungroupIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { useMeIdentities } from "./useMeIdentities";
import { useProjectChannel } from "./useProjectChannel";

export interface UseIssueBoardResult {
  issues: Issue[];
  filteredIssues: Issue[];
  board: ReturnType<typeof buildBoardState>;
  /** True only while the first load is in flight. Background refreshes never set this. */
  loading: boolean;
  /** True while a silent background refresh (poll / realtime / manual) is in flight. */
  refreshing: boolean;
  refetch: () => Promise<void>;
  moveIssueOptimistically: (identifier: string, status: WorkflowStatusName, position: number) => Promise<void>;
  groupIssueOptimistically: (memberIdentifier: string, leadIdentifier: string) => Promise<void>;
  ungroupIssueOptimistically: (identifier: string) => Promise<void>;
  setIssues: React.Dispatch<React.SetStateAction<Issue[]>>;
}

export function useIssueBoard(
  projectSlug: string,
  filters: IssueFilters = emptyFilters(),
  statuses?: WorkflowStatusName[],
): UseIssueBoardResult {
  const meValues = useMeIdentities();
  const { search } = filters;

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadErrorToastId = `issue-board-${projectSlug}`;

  const refetch = useCallback(async () => {
    if (!projectSlug.trim()) return;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      // Assignee/creator/recent narrowing happens client-side (multi-select), so
      // we fetch the full board and only pass the text search to the server.
      setIssues(await listIssues(projectSlug, { search }));
      hasLoadedRef.current = true;
      toast.dismiss(loadErrorToastId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : i18n.t("issue.board.loadFailed");
      toast.error(message, { id: loadErrorToastId });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectSlug, search]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setLoading(true);
  }, [projectSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const filteredIssues = useMemo(
    () => applyIssueFilters(issues, filters, meValues),
    [issues, filters, meValues],
  );

  const board = useMemo(() => buildBoardState(filteredIssues, statuses), [filteredIssues, statuses]);

  const moveIssueOptimistically = useCallback(
    async (identifier: string, status: WorkflowStatusName, position: number) => {
      const previousBoard = buildBoardState(issues, statuses);
      const sourceStatus = findIssueStatus(previousBoard, identifier, statuses);
      if (!sourceStatus) return;

      // A unit moves together: resolve the group lead when a member is dragged,
      // and drag a parent's sub-issues along so the parent card and its subtasks
      // land in the same column. Mirrors the server cascade in `persist_group_move`.
      const { anchorIdentifier, followerIdentifiers } = resolveMoveUnit(issues, identifier);
      const nextBoard = moveGroupLocally(
        previousBoard,
        anchorIdentifier,
        followerIdentifiers,
        status,
        position,
        statuses,
      );
      setIssues(flattenBoardState(nextBoard));

      try {
        await moveIssue(projectSlug, anchorIdentifier, { status, position });
      } catch (cause) {
        setIssues(flattenBoardState(previousBoard));
        const message = cause instanceof Error ? cause.message : i18n.t("issue.board.moveFailed");
        toast.error(message);
      }
    },
    [issues, projectSlug, statuses],
  );

  const groupIssueOptimistically = useCallback(
    async (memberIdentifier: string, leadIdentifier: string) => {
      try {
        await groupIssue(projectSlug, memberIdentifier, leadIdentifier);
        await refetch();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : i18n.t("issue.board.moveFailed");
        toast.error(message);
      }
    },
    [projectSlug, refetch],
  );

  const ungroupIssueOptimistically = useCallback(
    async (identifier: string) => {
      try {
        await ungroupIssue(projectSlug, identifier);
        await refetch();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : i18n.t("issue.board.moveFailed");
        toast.error(message);
      }
    },
    [projectSlug, refetch],
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

  return {
    issues,
    filteredIssues,
    board,
    loading,
    refreshing,
    refetch,
    moveIssueOptimistically,
    groupIssueOptimistically,
    ungroupIssueOptimistically,
    setIssues,
  };
}
