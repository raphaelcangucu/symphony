import type { Project } from "@/types/project";
import type { CloneJob, WorkspaceTemplate } from "@/types/template";
import { http, trackerPath, unwrapData } from "./http";
import { normalizeProject, type BackendProjectDto } from "./mappers";

interface TemplateRepoDto {
  id?: number | string;
  github_full_name?: string;
  clone_url?: string;
  default_branch?: string | null;
  workspace_path?: string;
  role?: string | null;
}

interface TemplateDto {
  id: number | string;
  name: string;
  slug: string;
  description?: string | null;
  validation_commands?: string[] | null;
  workflow_statuses?: Array<Record<string, unknown>> | null;
  after_create_hook?: string | null;
  prompt_template?: string | null;
  dev_env_markdown?: string | null;
  metadata?: Record<string, unknown> | null;
  repositories?: TemplateRepoDto[] | null;
}

interface CloneJobDto {
  id: number | string;
  repository_id: number | string;
  status: CloneJob["status"];
  error?: string | null;
  commit_sha?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

function normalizeTemplate(dto: TemplateDto): WorkspaceTemplate {
  return {
    id: String(dto.id),
    name: dto.name,
    slug: dto.slug,
    description: dto.description ?? null,
    validationCommands: dto.validation_commands ?? [],
    workflowStatuses: dto.workflow_statuses ?? [],
    afterCreateHook: dto.after_create_hook ?? null,
    promptTemplate: dto.prompt_template ?? null,
    devEnvMarkdown: dto.dev_env_markdown ?? null,
    metadata: dto.metadata ?? {},
    repositories: (dto.repositories ?? []).map((repo) => ({
      id: repo.id !== undefined ? String(repo.id) : undefined,
      githubFullName: repo.github_full_name ?? "",
      cloneUrl: repo.clone_url ?? "",
      defaultBranch: repo.default_branch ?? null,
      workspacePath: repo.workspace_path ?? "",
      role: repo.role ?? null,
    })),
  };
}

function normalizeCloneJob(dto: CloneJobDto): CloneJob {
  return {
    id: String(dto.id),
    repositoryId: String(dto.repository_id),
    status: dto.status,
    error: dto.error ?? null,
    commitSha: dto.commit_sha ?? null,
    startedAt: dto.started_at ?? null,
    completedAt: dto.completed_at ?? null,
  };
}

export async function listTemplates(): Promise<WorkspaceTemplate[]> {
  const response = await http.get(trackerPath("/templates"));
  return unwrapData<TemplateDto[]>(response).map(normalizeTemplate);
}

export async function getTemplate(slug: string): Promise<WorkspaceTemplate> {
  const response = await http.get(trackerPath(`/templates/${encodeURIComponent(slug)}`));
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export async function deleteTemplate(slug: string): Promise<void> {
  await http.delete(trackerPath(`/templates/${encodeURIComponent(slug)}`));
}

export async function importTemplate(yaml: string): Promise<WorkspaceTemplate> {
  const response = await http.post(trackerPath("/templates/import"), { yaml });
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export interface InstantiateTemplateInput {
  name: string;
  slug: string;
  tracker?: { kind: string; config: Record<string, unknown> };
}

export async function instantiateTemplate(slug: string, input: InstantiateTemplateInput): Promise<Project> {
  const response = await http.post(trackerPath(`/templates/${encodeURIComponent(slug)}/instantiate`), input);
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export interface SaveAsTemplateInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

export async function saveProjectAsTemplate(projectSlug: string, input: SaveAsTemplateInput): Promise<WorkspaceTemplate> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/save_as_template`), input);
  return normalizeTemplate(unwrapData<TemplateDto>(response));
}

export async function listCloneJobs(projectSlug: string): Promise<CloneJob[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/clone_jobs`));
  return unwrapData<CloneJobDto[]>(response).map(normalizeCloneJob);
}
