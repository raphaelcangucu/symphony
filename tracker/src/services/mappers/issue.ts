import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { BlockerSummary } from "@/types/blocker";
import {
  AGENT_KINDS,
  type AgentKind,
  type AgentOption,
  type Issue,
  type IssueAssigneeOption,
  type IssueAttachment,
  type IssueFormOptions,
  type IssueLabelOption,
  type IssuePriority,
} from "@/types/issue";

import { maybeString, normalizeStatusName, type BackendId, type BackendWorkflowStatusDto } from "./shared";

export interface BackendIssueDto {
  id: BackendId;
  identifier: string;
  display_identifier?: string | null;
  displayIdentifier?: string | null;
  project_slug?: string | null;
  projectSlug?: string | null;
  status?: BackendWorkflowStatusDto | string | null;
  title: string;
  description?: string | null;
  priority?: IssuePriority | null;
  position?: number | null;
  labels?: string[] | null;
  blocked_by?: BackendBlockerSummaryDto[] | null;
  blockedBy?: BackendBlockerSummaryDto[] | null;
  assignee?: string | null;
  assignee_id?: string | null;
  creator?: string | null;
  url?: string | null;
  branch_name?: string | null;
  branchName?: string | null;
  agent_kind?: string | null;
  agentKind?: string | null;
  agent_goal?: string | null;
  agentGoal?: string | null;
  repository_full_name?: string | null;
  repositoryFullName?: string | null;
  parent_identifier?: string | null;
  parentIdentifier?: string | null;
  sub_issue_summary?: { total: number; completed: number; percent_completed: number } | null;
  subIssueSummary?: { total: number; completed: number; percentCompleted: number } | null;
  attachments?: BackendIssueAttachmentDto[] | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

interface BackendIssueAttachmentDto {
  id?: BackendId | null;
  filename?: string | null;
  mime_type?: string | null;
  mimeType?: string | null;
  size?: number | null;
  created?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  author?: string | null;
  is_image?: boolean | null;
  isImage?: boolean | null;
}

interface BackendBlockerSummaryDto {
  id: BackendId;
  identifier?: string | null;
  target_identifier?: string | null;
  state?: string | null;
  type?: string | null;
}

export function normalizeIssue(dto: BackendIssueDto): Issue {
  const rawAgentKind = dto.agentKind ?? dto.agent_kind ?? null;
  const agentKind: AgentKind | null =
    (AGENT_KINDS as readonly string[]).includes(rawAgentKind ?? "") ? (rawAgentKind as AgentKind) : null;

  return {
    id: String(dto.id),
    identifier: normalizeIssueIdentifier(dto.identifier),
    displayIdentifier: normalizeIssueIdentifier(
      dto.displayIdentifier ?? dto.display_identifier ?? dto.identifier,
    ),
    projectSlug: dto.projectSlug ?? dto.project_slug ?? "",
    status: normalizeStatusName(dto.status),
    title: dto.title,
    description: dto.description ?? null,
    priority: dto.priority ?? null,
    position: dto.position ?? 0,
    labels: dto.labels ?? [],
    blockedBy: (dto.blockedBy ?? dto.blocked_by ?? []).map(normalizeBlockerSummary),
    assignee: dto.assignee ?? dto.assignee_id ?? null,
    creator: dto.creator ?? null,
    url: dto.url ?? null,
    branchName: dto.branchName ?? dto.branch_name ?? null,
    agentKind,
    agentGoal: normalizeAgentGoal(dto.agentGoal ?? dto.agent_goal),
    attachments: (dto.attachments ?? []).flatMap(normalizeIssueAttachment),
    repositoryFullName: dto.repositoryFullName ?? dto.repository_full_name ?? null,
    parentIdentifier: dto.parentIdentifier ?? dto.parent_identifier ?? null,
    subIssueSummary: normalizeSubIssueSummary(dto),
    createdAt: dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? dto.inserted_at ?? "",
  };
}

function normalizeSubIssueSummary(dto: BackendIssueDto): Issue["subIssueSummary"] {
  const camel = dto.subIssueSummary;
  if (camel) return camel;
  const snake = dto.sub_issue_summary;
  if (!snake) return null;
  return { total: snake.total, completed: snake.completed, percentCompleted: snake.percent_completed };
}

function normalizeAgentGoal(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIssueAttachment(dto: BackendIssueAttachmentDto): IssueAttachment[] {
  const id = maybeString(dto.id);
  if (!id) return [];

  return [
    {
      id,
      filename: dto.filename?.trim() || id,
      mimeType: dto.mimeType ?? dto.mime_type ?? null,
      size: typeof dto.size === "number" ? dto.size : null,
      createdAt: dto.createdAt ?? dto.created_at ?? dto.created ?? null,
      author: dto.author ?? null,
      isImage: dto.isImage ?? dto.is_image ?? false,
    },
  ];
}

function normalizeBlockerSummary(dto: BackendBlockerSummaryDto): BlockerSummary {
  return {
    id: String(dto.id),
    identifier: dto.identifier ?? dto.target_identifier ?? "",
    state: dto.state ?? dto.type ?? null,
  };
}

interface BackendLabelOptionDto {
  id?: string | null;
  name?: string | null;
  color?: string | null;
}

interface BackendAssigneeOptionDto {
  id?: string | null;
  login?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
}

interface BackendAgentOptionDto {
  value?: string | null;
  label?: string | null;
  default?: boolean | null;
}

export interface BackendIssueFormOptionsDto {
  labels?: BackendLabelOptionDto[] | null;
  assignees?: BackendAssigneeOptionDto[] | null;
  statuses?: BackendWorkflowStatusDto[] | null;
  agents?: BackendAgentOptionDto[] | null;
  effective_agent?: string | null;
  effectiveAgent?: string | null;
}

export function normalizeIssueFormOptions(dto: BackendIssueFormOptionsDto): IssueFormOptions {
  const rawEffective = dto.effectiveAgent ?? dto.effective_agent ?? null;
  const effectiveAgent: AgentKind =
    (AGENT_KINDS as readonly string[]).includes(rawEffective ?? "") ? (rawEffective as AgentKind) : "codex";

  return {
    labels: (dto.labels ?? []).flatMap(normalizeLabelOption),
    assignees: (dto.assignees ?? []).map(normalizeAssigneeOption),
    statuses: (dto.statuses ?? []).map((status) => normalizeStatusName(status.name ?? null)),
    agents: (dto.agents ?? []).flatMap(normalizeAgentOption),
    effectiveAgent,
  };
}

function normalizeLabelOption(dto: BackendLabelOptionDto): IssueLabelOption[] {
  const name = dto.name?.trim();
  if (!name) return [];
  return [{ id: dto.id ?? null, name, color: dto.color ?? null }];
}

function normalizeAssigneeOption(dto: BackendAssigneeOptionDto): IssueAssigneeOption {
  return {
    id: dto.id ?? null,
    login: dto.login ?? null,
    name: dto.name ?? null,
    avatarUrl: dto.avatarUrl ?? dto.avatar_url ?? null,
  };
}

function normalizeAgentOption(dto: BackendAgentOptionDto): AgentOption[] {
  if (!(typeof dto.value === "string" && (AGENT_KINDS as readonly string[]).includes(dto.value))) return [];
  const value = dto.value as AgentKind;
  return [{ value, label: dto.label?.trim() || value, default: dto.default ?? false }];
}
