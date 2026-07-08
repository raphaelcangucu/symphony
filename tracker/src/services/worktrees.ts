import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { AssistantThread } from "@/types/assistant-thread";
import type {
  WorkspaceInventory,
  WorkspaceInventoryEntry,
  WorkspaceInventoryKind,
  WorkspaceRemovalResult,
  WorkspaceRepoState,
  WorkspaceChildWorktree,
} from "@/types/worktrees";

import { normalizeAssistantThread, type BackendAssistantThreadDto } from "./assistantThreads";
import { http, trackerPath } from "./http";

interface BackendRepoDto {
  name: string;
  path: string;
  branch?: string | null;
  default_branch?: string | null;
  dirty: boolean;
  upstream: boolean;
  ahead_count: number;
  size_bytes: number;
}

interface BackendChildWorktreeDto {
  path: string;
  repo_name: string;
  slug: string;
  branch?: string | null;
  dirty: boolean;
  size_bytes: number;
}

interface BackendWorkspaceEntryDto {
  path: string;
  kind: string;
  issue_identifier?: string | null;
  name?: string | null;
  classification: string;
  reclaimable: boolean;
  work_present: boolean;
  execution_status?: string | null;
  removable: boolean;
  size_bytes: number;
  repos: BackendRepoDto[];
  child_worktrees: BackendChildWorktreeDto[];
}

interface BackendInventoryDto {
  data: BackendWorkspaceEntryDto[];
  totals: { count: number; size_bytes: number; reclaimable_bytes: number };
}

interface BackendRemovalDto {
  path: string;
  status: string;
  reason?: string | null;
}

const WORKSPACE_KINDS: readonly WorkspaceInventoryKind[] = [
  "issue",
  "issue_parallel",
  "project",
  "standalone",
  "unknown",
];

function normalizeKind(value: string): WorkspaceInventoryKind {
  return (WORKSPACE_KINDS as readonly string[]).includes(value)
    ? (value as WorkspaceInventoryKind)
    : "unknown";
}

function normalizeRepo(dto: BackendRepoDto): WorkspaceRepoState {
  return {
    name: dto.name,
    path: dto.path,
    branch: dto.branch ?? null,
    defaultBranch: dto.default_branch ?? null,
    dirty: dto.dirty,
    upstream: dto.upstream,
    aheadCount: dto.ahead_count,
    sizeBytes: dto.size_bytes,
  };
}

function normalizeChildWorktree(dto: BackendChildWorktreeDto): WorkspaceChildWorktree {
  return {
    path: dto.path,
    repoName: dto.repo_name,
    slug: dto.slug,
    branch: dto.branch ?? null,
    dirty: dto.dirty,
    sizeBytes: dto.size_bytes,
  };
}

function normalizeEntry(dto: BackendWorkspaceEntryDto): WorkspaceInventoryEntry {
  return {
    path: dto.path,
    kind: normalizeKind(dto.kind),
    issueIdentifier: dto.issue_identifier ?? null,
    name: dto.name ?? null,
    classification: dto.classification === "orphan" ? "orphan" : "active",
    reclaimable: dto.reclaimable,
    workPresent: dto.work_present,
    executionStatus: dto.execution_status ?? null,
    removable: dto.removable,
    sizeBytes: dto.size_bytes,
    repos: dto.repos.map(normalizeRepo),
    childWorktrees: dto.child_worktrees.map(normalizeChildWorktree),
  };
}

export async function fetchWorkspaceInventory(projectSlug: string): Promise<WorkspaceInventory> {
  const slug = encodeURIComponent(requireProjectSlug(projectSlug));
  const response = await http.get<BackendInventoryDto>(trackerPath(`/projects/${slug}/worktrees`));

  return {
    entries: response.data.data.map(normalizeEntry),
    totals: {
      count: response.data.totals.count,
      sizeBytes: response.data.totals.size_bytes,
      reclaimableBytes: response.data.totals.reclaimable_bytes,
    },
  };
}

export async function removeWorkspaces(
  projectSlug: string,
  paths: string[],
): Promise<WorkspaceRemovalResult[]> {
  const slug = encodeURIComponent(requireProjectSlug(projectSlug));
  if (paths.length === 0) return [];

  const response = await http.delete<{ data: BackendRemovalDto[] }>(
    trackerPath(`/projects/${slug}/worktrees`),
    { data: { paths } },
  );

  return response.data.data.map((dto) => ({
    path: dto.path,
    status: dto.status === "removed" ? "removed" : "skipped",
    reason: dto.reason ?? null,
  }));
}

export interface CreateStandaloneWorkspaceInput {
  name: string;
  title?: string;
  agentKind?: "codex" | "claude" | "cursor" | null;
  /** Repo directory name -> branch to clone. Missing repos use their default branch. */
  branches?: Record<string, string>;
}

export interface CreateStandaloneWorkspaceResult {
  workspacePath: string;
  thread: AssistantThread;
}

export async function createStandaloneWorkspace(
  projectSlug: string,
  input: CreateStandaloneWorkspaceInput,
): Promise<CreateStandaloneWorkspaceResult> {
  const slug = encodeURIComponent(requireProjectSlug(projectSlug));
  const name = requireNonBlank(input.name, "name");

  const response = await http.post<{
    data: { workspace_path: string; thread: BackendAssistantThreadDto };
  }>(trackerPath(`/projects/${slug}/workspaces`), {
    name,
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
    branches: input.branches ?? undefined,
  });

  return {
    workspacePath: response.data.data.workspace_path,
    thread: normalizeAssistantThread(response.data.data.thread),
  };
}
