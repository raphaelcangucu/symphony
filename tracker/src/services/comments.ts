import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { Comment, CreateCommentInput, UpdateCommentInput } from "@/types/comment";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendCommentDto, normalizeComment } from "./mappers";

export async function listComments(projectSlug: string, identifier: string): Promise<Comment[]> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/comments`),
  );
  return unwrapData<BackendCommentDto[]>(response).map((comment) => normalizeComment(comment, issueId));
}

export async function createComment(projectSlug: string, identifier: string, input: CreateCommentInput): Promise<Comment> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  requireNonBlank(input.body, "comment body");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/comments`),
    input,
  );
  return normalizeComment(unwrapData<BackendCommentDto>(response), issueId);
}

export async function updateComment(
  projectSlug: string,
  identifier: string,
  commentId: string,
  input: UpdateCommentInput,
): Promise<Comment> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const id = requireNonBlank(commentId, "comment id");
  requireNonBlank(input.body, "comment body");
  const response = await http.patch(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(id)}`,
    ),
    input,
  );
  return normalizeComment(unwrapData<BackendCommentDto>(response), issueId);
}

export async function deleteComment(projectSlug: string, identifier: string, commentId: string): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const id = requireNonBlank(commentId, "comment id");
  await http.delete(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(id)}`,
    ),
  );
}
