import { useCallback, useEffect, useRef, useState } from "react";

import { createComment, listComments } from "@/services/comments";
import type { Comment, CreateCommentInput } from "@/types/comment";

interface UseIssueCommentsArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueCommentsResult {
  comments: Comment[];
  workpad: Comment | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addComment: (input: CreateCommentInput) => Promise<Comment>;
}

function sortByCreatedAt(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function latestWorkpad(comments: Comment[]): Comment | null {
  const workpads = comments.filter((comment) => comment.kind === "workpad");
  return workpads.length > 0 ? workpads[workpads.length - 1] : null;
}

/**
 * Loads issue comments (including the agent's `Codex Workpad`) once per issue.
 * Centralizing the fetch lets the drawer surface the workpad in the summary
 * while the Comments tab reuses the same data without a second request.
 */
export function useIssueComments({
  projectSlug,
  identifier,
  enabled = true,
}: UseIssueCommentsArgs): UseIssueCommentsResult {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const items = await listComments(projectSlug, identifier);
      setComments(sortByCreatedAt(items));
      setError(null);
    } catch {
      setError("Could not load comments.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) {
      setComments([]);
      setError(null);
      setLoading(false);
      return;
    }
    void refetch();
  }, [active, refetch]);

  const addComment = useCallback(
    async (input: CreateCommentInput) => {
      if (!identifier || !projectSlug) throw new Error("issue is required");
      const created = await createComment(projectSlug, identifier, input);
      setComments((current) => sortByCreatedAt([...current, created]));
      return created;
    },
    [identifier, projectSlug],
  );

  return { comments, workpad: latestWorkpad(comments), loading, error, refetch, addComment };
}
