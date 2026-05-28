import type { CreateIssueInput, Issue, MoveIssueInput } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

export async function listIssues(projectSlug: string): Promise<Issue[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues`));
  return unwrapData<BackendIssueDto[]>(response).map(normalizeIssue);
}

export async function getIssue(projectSlug: string, identifier: string): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function createIssue(projectSlug: string, input: CreateIssueInput): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!input.title.trim()) throw new Error("title is required");
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues`), input);
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function moveIssue(projectSlug: string, identifier: string, input: MoveIssueInput): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/move`),
    input,
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}
