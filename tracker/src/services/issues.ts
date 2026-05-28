import type { CreateIssueInput, Issue, MoveIssueInput } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

export interface IssueListFilters {
  search?: string;
  assignee?: string;
  creator?: string;
}

export async function listIssues(projectSlug: string, filters: IssueListFilters = {}): Promise<Issue[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");

  const params = buildIssueListParams(filters);
  const path = trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues`);
  const response =
    Object.keys(params).length === 0 ? await http.get(path) : await http.get(path, { params });

  return unwrapData<BackendIssueDto[]>(response).map(normalizeIssue);
}

function buildIssueListParams(filters: IssueListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.search && filters.search.trim()) params.q = filters.search.trim();
  if (filters.assignee && filters.assignee.trim()) params.assignee = filters.assignee.trim();
  if (filters.creator && filters.creator.trim()) params.creator = filters.creator.trim();
  return params;
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
