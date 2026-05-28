import type { Project } from "@/types/project";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendProjectDto, normalizeProject } from "./mappers";

export async function listProjects(): Promise<Project[]> {
  const response = await http.get(trackerPath("/projects"));
  return unwrapData<BackendProjectDto[]>(response).map(normalizeProject);
}

export async function getProject(projectSlug: string): Promise<Project> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}`));
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}
