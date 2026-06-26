import type { Project } from "@/types/project";

import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendProjectDto, normalizeProject } from "./mappers";

export interface ProjectShareInfo {
  gist_id: string;
  html_url: string;
  raw_url: string | null;
  filename: string;
}

export async function exportProject(projectSlug: string): Promise<string> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/export`), { responseType: "text" });
  return response.data as string;
}

export async function importProject(yaml: string): Promise<Project> {
  const response = await http.post(trackerPath("/projects/import"), { yaml });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function importProjectFromUrl(url: string): Promise<Project> {
  const response = await http.post(trackerPath("/projects/import"), { url });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function importProjectConfig(projectSlug: string, yaml: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/import`), { yaml });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

export async function importProjectConfigFromUrl(projectSlug: string, url: string): Promise<Project> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/import`), { url });
  return normalizeProject(unwrapData<BackendProjectDto>(response));
}

function gistStorageKey(projectSlug: string) {
  return `symphony:project-gist:${projectSlug}`;
}

export async function shareProject(projectSlug: string): Promise<ProjectShareInfo> {
  const slug = requireProjectSlug(projectSlug);
  const gistId = window.localStorage.getItem(gistStorageKey(slug)) ?? undefined;
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/share`), gistId ? { gist_id: gistId } : {});
  const info = unwrapData<ProjectShareInfo>(response);
  if (info.gist_id) {
    window.localStorage.setItem(gistStorageKey(slug), info.gist_id);
  }
  return info;
}
