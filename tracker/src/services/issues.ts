import type { CreateIssueInput, Issue, IssueFormOptions, MoveIssueInput } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import {
  type BackendIssueDto,
  type BackendIssueFormOptionsDto,
  normalizeIssue,
  normalizeIssueFormOptions,
} from "./mappers";

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

export async function getIssueFormOptions(projectSlug: string): Promise<IssueFormOptions> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/form_options`));
  return normalizeIssueFormOptions(unwrapData<BackendIssueFormOptionsDto>(response));
}

export async function createIssue(projectSlug: string, input: CreateIssueInput): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!input.title.trim()) throw new Error("title is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues`),
    serializeCreateInput(input),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

function serializeCreateInput(input: CreateIssueInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: input.title,
    description: input.description ?? null,
    status: input.status,
  };

  if (input.priority !== undefined && input.priority !== null) payload.priority = input.priority;
  if (input.labelIds && input.labelIds.length > 0) payload.label_ids = input.labelIds;
  if (input.assigneeIds && input.assigneeIds.length > 0) payload.assignee_ids = input.assigneeIds;
  if (input.agent) payload.agent = input.agent;
  if (input.agent === "codex" && input.goal?.trim()) payload.goal = input.goal.trim();

  return payload;
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

export async function archiveIssue(projectSlug: string, identifier: string): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/archive`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function restoreIssue(projectSlug: string, identifier: string): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/restore`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function deleteIssue(projectSlug: string, identifier: string): Promise<Issue> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.delete(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}
