import type { Project } from "@/types/project";
import type { ProjectSetup } from "@/types/project-setup";
import type { WorkspaceRepository } from "@/types/repository";
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
}

export async function listProjects(): Promise<Project[]> {
  const response = await http.get(trackerPath("/projects"));
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

  if (!name) throw new Error("Project name is required");
  if (!slug) throw new Error("Project slug is required");
  if (input.workflowStatuses.length === 0) throw new Error("At least one workflow status is required");
  if (input.repositories.length === 0) throw new Error("At least one repository is required");

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
  });

  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function getProject(projectSlug: string): Promise<Project> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null));
}
