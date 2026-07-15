import type { Project, ProjectSyncState, ProjectSyncStatus, TrackerKind } from "@/types/project";
import type { ProjectSetup, WorkspaceSuggestion } from "@/types/project-setup";
import type { GitHubOwner, RepositoryScan, WorkspaceRepository } from "@/types/repository";

import { maybeString, normalizeWorkflowStatus, type BackendId, type BackendWorkflowStatusDto } from "./shared";

export interface BackendRepositoryDto {
  id?: BackendId;
  name?: string | null;
  full_name?: string | null;
  github_full_name?: string | null;
  description?: string | null;
  url?: string | null;
  clone_url?: string | null;
  ssh_url?: string | null;
  default_branch?: string | null;
  selected_branch?: string | null;
  private?: boolean | null;
  avatar_url?: string | null;
  suggested_local_path?: string | null;
  local_path?: string | null;
  workspace_path?: string | null;
  role?: string | null;
  scan_summary?: Record<string, unknown> | null;
}

export interface BackendGitHubOwnerDto {
  login?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  kind?: string | null;
}

export interface BackendProjectSetupDto {
  id?: BackendId;
  workflow_markdown?: string | null;
  after_create_hook?: string | null;
  validation_commands?: string[] | null;
  scan_summary?: Record<string, unknown> | null;
}

export interface BackendRepositoryScanDto {
  local_path?: string | null;
  workspace_path?: string | null;
  stack?: string[] | null;
  package_manager?: string | null;
  scripts?: string[] | null;
  agent_instruction_files?: string[] | null;
  validation_commands?: string[] | null;
  error?: string | null;
}

export interface BackendWorkspaceSuggestionDto {
  workflow_statuses?: BackendWorkflowStatusDto[] | null;
  workflow_markdown?: string | null;
  validation_commands?: string[] | null;
  after_create_hook?: string | null;
  scan_summary?: Record<string, unknown> | null;
}

export interface BackendProjectDto {
  id: BackendId;
  slug: string;
  name: string;
  description?: string | null;
  issue_count?: number | null;
  statuses?: BackendWorkflowStatusDto[] | null;
  repositories?: BackendRepositoryDto[] | null;
  setup?: BackendProjectSetupDto | null;
  tracker_kind?: string | null;
  tracker_config?: Record<string, unknown> | null;
  tracker_url?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity_at?: string | null;
  archived_at?: string | null;
  warm_up_status?: string | null;
  warmed_at?: string | null;
  last_warm_up_run_id?: number | null;
  sync_state?: BackendProjectSyncStateDto | null;
}

export interface BackendProjectSyncStateDto {
  status?: string | null;
  last_error?: string | null;
  last_pull_at?: string | null;
  last_push_at?: string | null;
  last_full_sync_at?: string | null;
}

export function normalizeProject(dto: BackendProjectDto): Project {
  return {
    id: String(dto.id),
    slug: dto.slug,
    name: dto.name,
    description: dto.description ?? null,
    issueCount: dto.issue_count ?? undefined,
    workflowStatuses: (dto.statuses ?? [])
      .map(normalizeWorkflowStatus)
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)),
    repositories: (dto.repositories ?? []).map(normalizeRepository),
    setup: dto.setup ? normalizeProjectSetup(dto.setup) : null,
    tracker: {
      kind: (dto.tracker_kind as TrackerKind) ?? "local",
      config: dto.tracker_config ?? {},
    },
    trackerUrl: dto.tracker_url ?? null,
    syncState: normalizeProjectSyncState(dto.sync_state),
    createdAt: dto.created_at ?? dto.inserted_at ?? undefined,
    updatedAt: dto.updated_at ?? dto.inserted_at ?? undefined,
    lastActivityAt: dto.last_activity_at ?? null,
    archivedAt: dto.archived_at ?? null,
    warmUpStatus: (dto.warm_up_status ?? "never") as Project["warmUpStatus"],
    warmedAt: dto.warmed_at ?? null,
    lastWarmUpRunId: dto.last_warm_up_run_id ?? null,
  };
}

const PROJECT_SYNC_STATUSES: readonly ProjectSyncStatus[] = ["idle", "syncing", "error"];

function normalizeProjectSyncState(dto: BackendProjectSyncStateDto | null | undefined): ProjectSyncState | null {
  if (!dto) return null;
  const rawStatus = dto.status ?? "idle";
  return {
    status: (PROJECT_SYNC_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ProjectSyncStatus) : "idle",
    lastError: dto.last_error ?? null,
    lastPullAt: dto.last_pull_at ?? null,
    lastPushAt: dto.last_push_at ?? null,
    lastFullSyncAt: dto.last_full_sync_at ?? null,
  };
}

export function normalizeRepository(dto: BackendRepositoryDto): WorkspaceRepository {
  const suggestedLocalPath = dto.suggested_local_path ?? null;

  return {
    id: maybeString(dto.id) ?? undefined,
    name: dto.name ?? null,
    fullName: dto.full_name ?? dto.github_full_name ?? "",
    description: dto.description ?? null,
    url: dto.url ?? null,
    cloneUrl: dto.clone_url ?? null,
    sshUrl: dto.ssh_url ?? null,
    defaultBranch: dto.default_branch ?? null,
    selectedBranch: dto.selected_branch ?? null,
    private: dto.private ?? false,
    avatarUrl: dto.avatar_url ?? null,
    suggestedLocalPath,
    localPath: dto.local_path ?? suggestedLocalPath,
    workspacePath: dto.workspace_path ?? "",
    role: dto.role ?? "service",
    scanSummary: dto.scan_summary ?? {},
  };
}

export function normalizeGitHubOwner(dto: BackendGitHubOwnerDto): GitHubOwner {
  return {
    login: dto.login ?? "",
    name: dto.name ?? null,
    avatarUrl: dto.avatar_url ?? null,
    kind: dto.kind === "organization" ? "organization" : "user",
  };
}

export function normalizeRepositoryScan(dto: BackendRepositoryScanDto): RepositoryScan {
  return {
    localPath: dto.local_path ?? null,
    workspacePath: dto.workspace_path ?? "",
    stack: dto.stack ?? [],
    packageManager: dto.package_manager ?? null,
    scripts: dto.scripts ?? [],
    agentInstructionFiles: dto.agent_instruction_files ?? [],
    validationCommands: dto.validation_commands ?? [],
    error: dto.error ?? null,
  };
}

export function normalizeWorkspaceSuggestion(dto: BackendWorkspaceSuggestionDto): WorkspaceSuggestion {
  return {
    workflowStatuses: (dto.workflow_statuses ?? []).map(normalizeWorkflowStatus),
    workflowMarkdown: dto.workflow_markdown ?? "",
    validationCommands: dto.validation_commands ?? [],
    afterCreateHook: dto.after_create_hook ?? "",
    scanSummary: dto.scan_summary ?? {},
  };
}

function normalizeProjectSetup(dto: BackendProjectSetupDto): ProjectSetup {
  return {
    id: maybeString(dto.id) ?? undefined,
    workflowMarkdown: dto.workflow_markdown ?? null,
    afterCreateHook: dto.after_create_hook ?? null,
    validationCommands: dto.validation_commands ?? [],
    scanSummary: dto.scan_summary ?? {},
  };
}
