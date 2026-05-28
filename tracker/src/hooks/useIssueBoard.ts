import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  buildBoardState,
  findIssueStatus,
  flattenBoardState,
  moveIssueLocally,
} from "@/components/board/board-utils";
import { listIssues, moveIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { useProjectChannel } from "./useProjectChannel";

export interface UseIssueBoardResult {
  issues: Issue[];
  board: ReturnType<typeof buildBoardState>;
  loading: boolean;
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

export function useIssueBoard(projectSlug: string): UseIssueBoardResult {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectSlug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setIssues(await listIssues(projectSlug));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to load issues";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const board = useMemo(() => buildBoardState(issues), [issues]);

  const moveIssueOptimistically = useCallback(
    async (identifier: string, status: WorkflowStatusName, position: number) => {
      const previousBoard = buildBoardState(issues);
      const sourceStatus = findIssueStatus(previousBoard, identifier);
      if (!sourceStatus) return;

      const nextBoard = moveIssueLocally(previousBoard, identifier, status, position);
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
    [issues, projectSlug],
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

  return { issues, board, loading, error, refetch, moveIssueOptimistically, setIssues };
}
