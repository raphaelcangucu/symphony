import type { WorkspaceSuggestion, WorkspaceSuggestionInput } from "@/types/project-setup";
import type { GitHubOwner, RepositoryScan, RepositoryScanRequest, WorkspaceRepository } from "@/types/repository";

import { i18n } from "@/i18n";

import { http, trackerPath, unwrapData } from "./http";
import {
  type BackendRepositoryDto,
  type BackendGitHubOwnerDto,
  type BackendRepositoryScanDto,
  type BackendWorkspaceSuggestionDto,
  normalizeGitHubOwner,
  normalizeRepository,
  normalizeRepositoryScan,
  normalizeWorkspaceSuggestion,
} from "./mappers";

export async function listGitHubOwners(): Promise<GitHubOwner[]> {
  const response = await http.get(trackerPath("/github/owners"));
  return unwrapData<BackendGitHubOwnerDto[]>(response)
    .map(normalizeGitHubOwner)
    .filter((owner) => owner.login.trim().length > 0);
}

export async function listGitHubRepositories(owner: string): Promise<WorkspaceRepository[]> {
  const trimmedOwner = owner.trim();
  if (!trimmedOwner) throw new Error(i18n.t("project.services.validation.githubOwnerRequired"));

  const response = await http.get(trackerPath(`/github/owners/${encodeURIComponent(trimmedOwner)}/repositories`));
  return unwrapData<BackendRepositoryDto[]>(response).map(normalizeRepository);
}

export async function scanRepositories(repositories: RepositoryScanRequest[]): Promise<RepositoryScan[]> {
  const response = await http.post(trackerPath("/project_setup/scan"), {
    repositories: repositories.map((repository) => ({
      local_path: repository.localPath,
      workspace_path: repository.workspacePath,
    })),
  });

  return unwrapData<{ scans: BackendRepositoryScanDto[] }>(response).scans.map(normalizeRepositoryScan);
}

export async function suggestWorkspaceSetup(input: WorkspaceSuggestionInput): Promise<WorkspaceSuggestion> {
  const response = await http.post(trackerPath("/project_setup/suggest"), {
    repositories: input.repositories.map(repositoryPayload),
    scans: input.scans.map(scanPayload),
  });

  return normalizeWorkspaceSuggestion(unwrapData<BackendWorkspaceSuggestionDto>(response));
}

export function repositoryPayload(repository: WorkspaceRepository): Record<string, unknown> {
  return compactPayload({
    github_full_name: repository.fullName,
    clone_url: repository.cloneUrl,
    default_branch: repository.defaultBranch,
    selected_branch: repository.selectedBranch,
    local_path: repository.localPath,
    workspace_path: repository.workspacePath,
    role: repository.role,
    scan_summary: repository.scanSummary,
  });
}

function scanPayload(scan: RepositoryScan): Record<string, unknown> {
  return compactPayload({
    local_path: scan.localPath,
    workspace_path: scan.workspacePath,
    stack: scan.stack,
    package_manager: scan.packageManager,
    scripts: scan.scripts,
    agent_instruction_files: scan.agentInstructionFiles,
    validation_commands: scan.validationCommands,
  });
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}
