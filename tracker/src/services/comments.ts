import type { Comment, CreateCommentInput, UpdateCommentInput } from "@/types/comment";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendCommentDto, normalizeComment } from "./mappers";

export async function listComments(projectSlug: string, identifier: string): Promise<Comment[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/comments`),
  );
  return unwrapData<BackendCommentDto[]>(response).map((comment) => normalizeComment(comment, identifier));
}

export async function createComment(projectSlug: string, identifier: string, input: CreateCommentInput): Promise<Comment> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  if (!input.body.trim()) throw new Error("comment body is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/comments`),
    input,
  );
  return normalizeComment(unwrapData<BackendCommentDto>(response), identifier);
}

export async function updateComment(
  projectSlug: string,
  identifier: string,
  commentId: string,
  input: UpdateCommentInput,
): Promise<Comment> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  if (!commentId.trim()) throw new Error("comment id is required");
  if (!input.body.trim()) throw new Error("comment body is required");
  const response = await http.patch(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/comments/${encodeURIComponent(commentId)}`,
    ),
    input,
  );
  return normalizeComment(unwrapData<BackendCommentDto>(response), identifier);
}

export async function deleteComment(projectSlug: string, identifier: string, commentId: string): Promise<void> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  if (!commentId.trim()) throw new Error("comment id is required");
  await http.delete(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/comments/${encodeURIComponent(commentId)}`,
    ),
  );
}
