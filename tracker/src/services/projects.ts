import type { Project, TrackerKind } from "@/types/project";
import type { ProjectSetup } from "@/types/project-setup";
import type { WorkspaceRepository } from "@/types/repository";
import type { WorkflowConfig } from "@/types/workflow-config";
import type { WorkflowStatus } from "@/types/workflow-status";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendProjectDto, normalizeProject } from "./mappers";
import { repositoryPayload } from "./projectSetup";

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string | null;
}

export interface CreateWorkspaceProjectInput extends CreateProjectInput {
  workflowStatuses: WorkflowStatus[];
  repositories: WorkspaceRepository[];
  setup: Partial<ProjectSetup>;
  tracker?: { kind: TrackerKind; config: Record<string, unknown> };
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  tracker?: { kind: TrackerKind; config: Record<string, unknown> };
}

export interface UpdateProjectSetupInput {
  workflowConfig?: WorkflowConfig;
  promptTemplate?: string | null;
  afterCreateHook?: string | null;
  validationCommands?: string[];
}

export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const response = options.includeArchived
    ? await http.get(trackerPath("/projects"), { params: { include_archived: "true" } })
    : await http.get(trackerPath("/projects"));
  return unwrapData<BackendProjectDto[]>(response).map(normalizeProject);
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  const description = input.description?.trim() || null;

  if (!name) throw new Error("Project name is required");
  if (!slug) throw new Error("Project slug is required");

  const response = await http.post(trackerPath("/projects"), { name, slug, description });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function createWorkspaceProject(input: CreateWorkspaceProjectInput): Promise<Project> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  const description = input.description?.trim() || null;
  const tracker = input.tracker ?? { kind: "local" as TrackerKind, config: {} };

  if (!name) throw new Error("Project name is required");
  if (!slug) throw new Error("Project slug is required");
  if (tracker.kind === "local") {
    if (input.workflowStatuses.length === 0) throw new Error("At least one workflow status is required");
    if (input.repositories.length === 0) throw new Error("At least one repository is required");
  }

  const response = await http.post(trackerPath("/projects/workspace"), {
    name,
    slug,
    description,
    workflow_statuses: input.workflowStatuses.map((status) => ({
      name: status.name,
      category: status.category,
      position: status.position,
      is_terminal: status.isTerminal,
    })),
    repositories: input.repositories.map(repositoryPayload),
    setup: compactPayload({
      workflow_config: input.setup.workflowConfig,
      after_create_hook: input.setup.afterCreateHook,
      prompt_template: input.setup.promptTemplate,
      validation_commands: input.setup.validationCommands,
      scan_summary: input.setup.scanSummary,
    }),
    tracker,
  });

  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function getProject(projectSlug: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function updateProject(projectSlug: string, input: UpdateProjectInput): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);

  const payload: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required");
    payload.name = name;
  }

  if (input.description !== undefined) {
    payload.description = input.description?.trim() || null;
  }

  if (input.tracker !== undefined) {
    payload.tracker = input.tracker;
  }

  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(slug)}`), payload);
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function updateProjectSetup(projectSlug: string, input: UpdateProjectSetupInput): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);

  const setup = compactPayload({
    workflow_config: input.workflowConfig,
    prompt_template: input.promptTemplate,
    after_create_hook: input.afterCreateHook,
    validation_commands: input.validationCommands,
  });

  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(slug)}/setup`), { setup });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function updateProjectRepositories(
  projectSlug: string,
  repositories: WorkspaceRepository[],
): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);

  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(slug)}/repositories`), {
    repositories: repositories.map(repositoryPayload),
  });

  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function archiveProject(projectSlug: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/archive`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function restoreProject(projectSlug: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/restore`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function deleteProject(projectSlug: string): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  await http.delete(trackerPath(`/projects/${encodeURIComponent(slug)}`));
}

function requireProjectSlug(projectSlug: string): string {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");
  return slug;
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null));
}
