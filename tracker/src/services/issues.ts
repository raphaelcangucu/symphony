import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type {
  AgentKind,
  CreateIssueInput,
  Issue,
  IssueFormOptions,
  MoveIssueInput,
  UpdateIssueInput,
} from "@/types/issue";

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
  const slug = requireProjectSlug(projectSlug);

  const params = buildIssueListParams(filters);
  const path = trackerPath(`/projects/${encodeURIComponent(slug)}/issues`);
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
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function getIssueFormOptions(projectSlug: string): Promise<IssueFormOptions> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/issues/form_options`));
  return normalizeIssueFormOptions(unwrapData<BackendIssueFormOptionsDto>(response));
}

export async function createIssue(projectSlug: string, input: CreateIssueInput): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  requireNonBlank(input.title, "title");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues`),
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

export async function updateIssue(
  projectSlug: string,
  identifier: string,
  input: UpdateIssueInput,
): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.patch(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`),
    serializeUpdateInput(input),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

function serializeUpdateInput(input: UpdateIssueInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.description !== undefined) payload.description = input.description;
  if (input.labelIds !== undefined) payload.label_ids = input.labelIds;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.assigneeIds !== undefined) payload.assignee_ids = input.assigneeIds;
  if (input.agent !== undefined) payload.agent = input.agent;
  return payload;
}

export async function moveIssue(projectSlug: string, identifier: string, input: MoveIssueInput): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/move`),
    input,
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function groupIssue(
  projectSlug: string,
  memberIdentifier: string,
  leadIdentifier: string,
): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const member = requireNonBlank(memberIdentifier, "identifier");
  const lead = requireNonBlank(leadIdentifier, "leadIdentifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(member)}/group`),
    { lead_identifier: lead },
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function ungroupIssue(projectSlug: string, identifier: string): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  await http.delete(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/group`),
  );
}

export async function forceSyncIssue(projectSlug: string, identifier: string): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/sync`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function archiveIssue(projectSlug: string, identifier: string): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/archive`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function restoreIssue(projectSlug: string, identifier: string): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/restore`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function updateIssueAgent(
  projectSlug: string,
  identifier: string,
  agent: AgentKind | null,
): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.put(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`),
    { agent },
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}

export async function deleteIssue(projectSlug: string, identifier: string): Promise<Issue> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.delete(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`),
  );
  return normalizeIssue(unwrapData<BackendIssueDto>(response));
}
