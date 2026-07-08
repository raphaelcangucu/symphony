import { useCallback } from "react";

import { useAsyncResource } from "@/hooks/useAsyncResource";
import { i18n } from "@/i18n";
import { createComment, deleteComment, listComments, updateComment } from "@/services/comments";
import type { Comment, CreateCommentInput, UpdateCommentInput } from "@/types/comment";

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
  updateComment: (commentId: string, input: UpdateCommentInput) => Promise<Comment>;
  deleteComment: (commentId: string) => Promise<void>;
}

const NO_COMMENTS: Comment[] = [];

function sortByCreatedAt(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function latestWorkpad(comments: Comment[]): Comment | null {
  let latest: Comment | null = null;
  for (const comment of comments) {
    if (comment.kind !== "workpad") continue;
    if (!latest || comment.createdAt.localeCompare(latest.createdAt) > 0) {
      latest = comment;
    }
  }
  return latest;
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
  const fetcher = useCallback(async () => {
    const items = await listComments(projectSlug, identifier ?? "");
    return sortByCreatedAt(items);
  }, [projectSlug, identifier]);

  const {
    data: comments,
    loading,
    error,
    refetch,
    setData: setComments,
  } = useAsyncResource<Comment[]>({
    fetcher,
    canFetch: Boolean(identifier && projectSlug),
    enabled,
    errorMessage: () => i18n.t("issue.comments.errors.loadFailed"),
    initialData: NO_COMMENTS,
    refetchOnActivate: "always",
    resetWhenInactive: true,
  });

  const addComment = useCallback(
    async (input: CreateCommentInput) => {
      if (!identifier || !projectSlug) {
        throw new Error(i18n.t("project.services.validation.fieldRequired", { field: "issue" }));
      }
      const created = await createComment(projectSlug, identifier, input);
      setComments((current) => sortByCreatedAt([...current, created]));
      return created;
    },
    [identifier, projectSlug, setComments],
  );

  const updateCommentById = useCallback(
    async (commentId: string, input: UpdateCommentInput) => {
      if (!identifier || !projectSlug) {
        throw new Error(i18n.t("project.services.validation.fieldRequired", { field: "issue" }));
      }
      const updated = await updateComment(projectSlug, identifier, commentId, input);
      setComments((current) => sortByCreatedAt(current.map((comment) => (comment.id === commentId ? updated : comment))));
      return updated;
    },
    [identifier, projectSlug, setComments],
  );

  const deleteCommentById = useCallback(
    async (commentId: string) => {
      if (!identifier || !projectSlug) {
        throw new Error(i18n.t("project.services.validation.fieldRequired", { field: "issue" }));
      }
      await deleteComment(projectSlug, identifier, commentId);
      setComments((current) => current.filter((comment) => comment.id !== commentId));
    },
    [identifier, projectSlug, setComments],
  );

  return {
    comments,
    workpad: latestWorkpad(comments),
    loading,
    error,
    refetch,
    addComment,
    updateComment: updateCommentById,
    deleteComment: deleteCommentById,
  };
}
