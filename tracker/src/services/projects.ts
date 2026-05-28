import type { Project } from "@/types/project";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendProjectDto, normalizeProject } from "./mappers";

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string | null;
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

export async function getProject(projectSlug: string): Promise<Project> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}
