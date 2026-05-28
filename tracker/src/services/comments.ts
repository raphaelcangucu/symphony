import type { Comment, CreateCommentInput } from "@/types/comment";

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
