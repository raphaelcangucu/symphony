import type { Project } from "@/types/project";

import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendProjectDto, normalizeProject } from "./mappers";

export async function exportProject(projectSlug: string): Promise<string> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/export`), { responseType: "text" });
  return response.data as string;
}

export async function importProject(yaml: string): Promise<Project> {
  const response = await http.post(trackerPath("/projects/import"), { yaml });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function importProjectConfig(projectSlug: string, yaml: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/import`), { yaml });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}
