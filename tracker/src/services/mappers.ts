import type { Blocker, BlockerState, BlockerSummary } from "@/types/blocker";
import type { Comment, CommentSyncStatus } from "@/types/comment";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
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
import type { Project, ProjectSyncState, ProjectSyncStatus, TrackerKind } from "@/types/project";
import type { ProjectSetup, WorkspaceSuggestion } from "@/types/project-setup";
import type {
  ProjectRealtimeEventName,
  ProjectRealtimePayloadByEvent,
} from "@/types/realtime-events";
import type { GitHubOwner, RepositoryScan, WorkspaceRepository } from "@/types/repository";
import type {
  WorkflowStatus,
  WorkflowStatusCategory,
  WorkflowStatusName,
} from "@/types/workflow-status";

type BackendId = string | number;

interface BackendWorkflowStatusDto {
  id?: BackendId;
  name?: string | null;
  category?: string | null;
  position?: number | null;
  is_terminal?: boolean | null;
  isTerminal?: boolean | null;
}

export interface BackendRepositoryDto {
  id?: BackendId;
  name?: string | null;
  full_name?: string | null;
  fullName?: string | null;
  github_full_name?: string | null;
  githubFullName?: string | null;
  description?: string | null;
  url?: string | null;
  clone_url?: string | null;
  cloneUrl?: string | null;
  ssh_url?: string | null;
  sshUrl?: string | null;
  default_branch?: string | null;
  defaultBranch?: string | null;
  selected_branch?: string | null;
  selectedBranch?: string | null;
  private?: boolean | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  suggested_local_path?: string | null;
  suggestedLocalPath?: string | null;
  local_path?: string | null;
  localPath?: string | null;
  workspace_path?: string | null;
  workspacePath?: string | null;
  role?: string | null;
  scan_summary?: Record<string, unknown> | null;
  scanSummary?: Record<string, unknown> | null;
}

export interface BackendGitHubOwnerDto {
  login?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  kind?: string | null;
}

export interface BackendProjectSetupDto {
  id?: BackendId;
  workflow_markdown?: string | null;
  workflowMarkdown?: string | null;
  after_create_hook?: string | null;
  afterCreateHook?: string | null;
  validation_commands?: string[] | null;
  validationCommands?: string[] | null;
  scan_summary?: Record<string, unknown> | null;
  scanSummary?: Record<string, unknown> | null;
}

export interface BackendRepositoryScanDto {
  local_path?: string | null;
  localPath?: string | null;
  workspace_path?: string | null;
  workspacePath?: string | null;
  stack?: string[] | null;
  package_manager?: string | null;
  packageManager?: string | null;
  scripts?: string[] | null;
  agent_instruction_files?: string[] | null;
  agentInstructionFiles?: string[] | null;
  validation_commands?: string[] | null;
  validationCommands?: string[] | null;
  error?: string | null;
}

export interface BackendWorkspaceSuggestionDto {
  workflow_statuses?: BackendWorkflowStatusDto[] | null;
  workflowStatuses?: BackendWorkflowStatusDto[] | null;
  workflow_markdown?: string | null;
  workflowMarkdown?: string | null;
  validation_commands?: string[] | null;
  validationCommands?: string[] | null;
  after_create_hook?: string | null;
  afterCreateHook?: string | null;
  scan_summary?: Record<string, unknown> | null;
  scanSummary?: Record<string, unknown> | null;
}

export interface BackendProjectDto {
  id: BackendId;
  slug: string;
  name: string;
  description?: string | null;
  issue_count?: number | null;
  issueCount?: number | null;
  statuses?: BackendWorkflowStatusDto[] | null;
  workflowStatuses?: BackendWorkflowStatusDto[] | null;
  repositories?: BackendRepositoryDto[] | null;
  setup?: BackendProjectSetupDto | null;
  tracker_kind?: string | null;
  tracker_config?: Record<string, unknown> | null;
  tracker_url?: string | null;
  trackerUrl?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  archived_at?: string | null;
  archivedAt?: string | null;
  sync_state?: BackendProjectSyncStateDto | null;
  syncState?: BackendProjectSyncStateDto | null;
}

export interface BackendProjectSyncStateDto {
  status?: string | null;
  last_error?: string | null;
  lastError?: string | null;
  last_pull_at?: string | null;
  lastPullAt?: string | null;
  last_push_at?: string | null;
  lastPushAt?: string | null;
  last_full_sync_at?: string | null;
  lastFullSyncAt?: string | null;
}

export interface BackendIssueDto {
  id: BackendId;
  identifier: string;
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

export interface BackendCommentDto {
  id: BackendId;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
  issue_id?: BackendId | null;
  body: string;
  author?: string | null;
  kind?: string | null;
  url?: string | null;
  sync_status?: string | null;
  syncStatus?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export interface BackendBlockerDto {
  id: BackendId;
  type?: string | null;
  source_identifier?: string | null;
  sourceIdentifier?: string | null;
  target_identifier?: string | null;
  targetIdentifier?: string | null;
  state?: BlockerState | string | null;
  reason?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

type BackendRealtimePayloadByEvent = {
  issue_created: { issue: BackendIssueDto };
  issue_updated: { issue: BackendIssueDto };
  issue_moved: { issue: BackendIssueDto };
  comment_created: { issue_identifier?: string | null; issueIdentifier?: string | null; comment: BackendCommentDto };
  blocker_changed: { issue_identifier?: string | null; issueIdentifier?: string | null; blocker: BackendBlockerDto };
};

export function normalizeIssue(dto: BackendIssueDto): Issue {
  const rawAgentKind = dto.agentKind ?? dto.agent_kind ?? null;
  const agentKind: AgentKind | null =
    (AGENT_KINDS as readonly string[]).includes(rawAgentKind ?? "") ? (rawAgentKind as AgentKind) : null;

  return {
    id: String(dto.id),
    identifier: normalizeIssueIdentifier(dto.identifier),
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
    attachments: (dto.attachments ?? []).flatMap(normalizeIssueAttachment),
    createdAt: dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? dto.inserted_at ?? "",
  };
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

export function normalizeProject(dto: BackendProjectDto): Project {
  return {
    id: String(dto.id),
    slug: dto.slug,
    name: dto.name,
    description: dto.description ?? null,
    issueCount: dto.issueCount ?? dto.issue_count ?? undefined,
    workflowStatuses: (dto.workflowStatuses ?? dto.statuses ?? [])
      .map(normalizeWorkflowStatus)
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)),
    repositories: (dto.repositories ?? []).map(normalizeRepository),
    setup: dto.setup ? normalizeProjectSetup(dto.setup) : null,
    tracker: {
      kind: (dto.tracker_kind as TrackerKind) ?? "local",
      config: dto.tracker_config ?? {},
    },
    trackerUrl: dto.trackerUrl ?? dto.tracker_url ?? null,
    syncState: normalizeProjectSyncState(dto.syncState ?? dto.sync_state),
    createdAt: dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? undefined,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? dto.inserted_at ?? undefined,
    archivedAt: dto.archivedAt ?? dto.archived_at ?? null,
  };
}

const PROJECT_SYNC_STATUSES: readonly ProjectSyncStatus[] = ["idle", "syncing", "error"];

function normalizeProjectSyncState(dto: BackendProjectSyncStateDto | null | undefined): ProjectSyncState | null {
  if (!dto) return null;
  const rawStatus = dto.status ?? "idle";
  return {
    status: (PROJECT_SYNC_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ProjectSyncStatus) : "idle",
    lastError: dto.lastError ?? dto.last_error ?? null,
    lastPullAt: dto.lastPullAt ?? dto.last_pull_at ?? null,
    lastPushAt: dto.lastPushAt ?? dto.last_push_at ?? null,
    lastFullSyncAt: dto.lastFullSyncAt ?? dto.last_full_sync_at ?? null,
  };
}

export function normalizeRepository(dto: BackendRepositoryDto): WorkspaceRepository {
  const suggestedLocalPath = dto.suggestedLocalPath ?? dto.suggested_local_path ?? null;

  return {
    id: maybeString(dto.id) ?? undefined,
    name: dto.name ?? null,
    fullName: dto.fullName ?? dto.full_name ?? dto.githubFullName ?? dto.github_full_name ?? "",
    description: dto.description ?? null,
    url: dto.url ?? null,
    cloneUrl: dto.cloneUrl ?? dto.clone_url ?? null,
    sshUrl: dto.sshUrl ?? dto.ssh_url ?? null,
    defaultBranch: dto.defaultBranch ?? dto.default_branch ?? null,
    selectedBranch: dto.selectedBranch ?? dto.selected_branch ?? null,
    private: dto.private ?? false,
    avatarUrl: dto.avatarUrl ?? dto.avatar_url ?? null,
    suggestedLocalPath,
    localPath: dto.localPath ?? dto.local_path ?? suggestedLocalPath,
    workspacePath: dto.workspacePath ?? dto.workspace_path ?? "",
    role: dto.role ?? "service",
    scanSummary: dto.scanSummary ?? dto.scan_summary ?? {},
  };
}

export function normalizeGitHubOwner(dto: BackendGitHubOwnerDto): GitHubOwner {
  return {
    login: dto.login ?? "",
    name: dto.name ?? null,
    avatarUrl: dto.avatarUrl ?? dto.avatar_url ?? null,
    kind: dto.kind === "organization" ? "organization" : "user",
  };
}

export function normalizeRepositoryScan(dto: BackendRepositoryScanDto): RepositoryScan {
  return {
    localPath: dto.localPath ?? dto.local_path ?? null,
    workspacePath: dto.workspacePath ?? dto.workspace_path ?? "",
    stack: dto.stack ?? [],
    packageManager: dto.packageManager ?? dto.package_manager ?? null,
    scripts: dto.scripts ?? [],
    agentInstructionFiles: dto.agentInstructionFiles ?? dto.agent_instruction_files ?? [],
    validationCommands: dto.validationCommands ?? dto.validation_commands ?? [],
    error: dto.error ?? null,
  };
}

export function normalizeWorkspaceSuggestion(dto: BackendWorkspaceSuggestionDto): WorkspaceSuggestion {
  return {
    workflowStatuses: (dto.workflowStatuses ?? dto.workflow_statuses ?? []).map(normalizeWorkflowStatus),
    workflowMarkdown: dto.workflowMarkdown ?? dto.workflow_markdown ?? "",
    validationCommands: dto.validationCommands ?? dto.validation_commands ?? [],
    afterCreateHook: dto.afterCreateHook ?? dto.after_create_hook ?? "",
    scanSummary: dto.scanSummary ?? dto.scan_summary ?? {},
  };
}

function normalizeProjectSetup(dto: BackendProjectSetupDto): ProjectSetup {
  return {
    id: maybeString(dto.id) ?? undefined,
    workflowMarkdown: dto.workflowMarkdown ?? dto.workflow_markdown ?? null,
    afterCreateHook: dto.afterCreateHook ?? dto.after_create_hook ?? null,
    validationCommands: dto.validationCommands ?? dto.validation_commands ?? [],
    scanSummary: dto.scanSummary ?? dto.scan_summary ?? {},
  };
}

export function normalizeComment(dto: BackendCommentDto, fallbackIssueIdentifier?: string | null): Comment {
  return {
    id: String(dto.id),
    issueIdentifier: normalizeIssueIdentifier(
      dto.issueIdentifier ?? dto.issue_identifier ?? fallbackIssueIdentifier ?? maybeString(dto.issue_id) ?? "",
    ),
    author: dto.author ?? null,
    body: dto.body,
    kind: dto.kind ?? null,
    url: dto.url ?? null,
    syncStatus: normalizeCommentSyncStatus(dto.syncStatus ?? dto.sync_status),
    createdAt: dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? dto.inserted_at ?? "",
  };
}

const COMMENT_SYNC_STATUSES: readonly CommentSyncStatus[] = ["synced", "pending", "conflict", "error", "archived"];

function normalizeCommentSyncStatus(value?: string | null): CommentSyncStatus | null {
  return (COMMENT_SYNC_STATUSES as readonly string[]).includes(value ?? "") ? (value as CommentSyncStatus) : null;
}

export function normalizeBlocker(dto: BackendBlockerDto, fallbackIssueIdentifier?: string | null): Blocker {
  const createdAt = dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "";

  return {
    id: String(dto.id),
    issueIdentifier: normalizeIssueIdentifier(dto.sourceIdentifier ?? dto.source_identifier ?? fallbackIssueIdentifier ?? ""),
    blockingIssueIdentifier: normalizeOptionalIssueIdentifier(dto.targetIdentifier ?? dto.target_identifier),
    reason: dto.reason ?? dto.type ?? "blocked_by",
    state: normalizeBlockerState(dto.state),
    createdAt,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? createdAt,
  };
}

export function normalizeProjectRealtimePayload<TEvent extends ProjectRealtimeEventName>(
  event: TEvent,
  payload: BackendRealtimePayloadByEvent[TEvent],
): ProjectRealtimePayloadByEvent[TEvent] {
  if (event === "comment_created") {
    const commentPayload = payload as BackendRealtimePayloadByEvent["comment_created"];
    const issueIdentifier = normalizeIssueIdentifier(commentPayload.issueIdentifier ?? commentPayload.issue_identifier ?? "");
    return {
      issueIdentifier,
      comment: normalizeComment(commentPayload.comment, issueIdentifier),
    } as ProjectRealtimePayloadByEvent[TEvent];
  }

  if (event === "blocker_changed") {
    const blockerPayload = payload as BackendRealtimePayloadByEvent["blocker_changed"];
    const issueIdentifier = normalizeIssueIdentifier(blockerPayload.issueIdentifier ?? blockerPayload.issue_identifier ?? "");
    return {
      issueIdentifier,
      blocker: normalizeBlocker(blockerPayload.blocker, issueIdentifier),
    } as ProjectRealtimePayloadByEvent[TEvent];
  }

  const issuePayload = payload as BackendRealtimePayloadByEvent["issue_created"];
  return { issue: normalizeIssue(issuePayload.issue) } as ProjectRealtimePayloadByEvent[TEvent];
}

function normalizeStatusName(status: BackendIssueDto["status"]): WorkflowStatusName {
  if (typeof status === "string") return status.trim() ? (status as WorkflowStatusName) : "Backlog";
  if (status && typeof status.name === "string" && status.name.trim()) {
    return status.name as WorkflowStatusName;
  }
  return "Backlog";
}

function normalizeWorkflowStatus(dto: BackendWorkflowStatusDto): WorkflowStatus {
  return {
    id: maybeString(dto.id) ?? "",
    name: normalizeStatusName(dto.name ?? null),
    category: normalizeWorkflowStatusCategory(dto.category),
    position: dto.position ?? 0,
    isTerminal: dto.isTerminal ?? dto.is_terminal ?? false,
  };
}

function normalizeWorkflowStatusCategory(category: string | null | undefined): WorkflowStatusCategory {
  if (
    category === "backlog" ||
    category === "unstarted" ||
    category === "started" ||
    category === "completed" ||
    category === "canceled" ||
    category === "active" ||
    category === "wait" ||
    category === "terminal"
  ) {
    return category;
  }
  return "backlog";
}

function normalizeBlockerSummary(dto: BackendBlockerSummaryDto): BlockerSummary {
  return {
    id: String(dto.id),
    identifier: dto.identifier ?? dto.target_identifier ?? "",
    state: dto.state ?? dto.type ?? null,
  };
}

function normalizeBlockerState(state: BackendBlockerDto["state"]): BlockerState {
  if (state === "resolved" || state === "canceled") return state;
  return "open";
}

function normalizeOptionalIssueIdentifier(identifier: string | null | undefined): string | null {
  const normalized = normalizeIssueIdentifier(identifier);
  return normalized || null;
}

function maybeString(value: BackendId | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}
