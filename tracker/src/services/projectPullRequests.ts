import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

export interface ProjectPullRequest {
  number: number;
  title: string | null;
  url: string | null;
  repo: string | null;
  author: string | null;
  updatedAt: string | null;
  issueIdentifier: string | null;
}

interface BackendProjectPullRequestDto {
  number: number;
  title?: string | null;
  url?: string | null;
  repo?: string | null;
  author?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
}

export async function listProjectPullRequests(
  projectSlug: string,
  options: { search?: string } = {},
): Promise<ProjectPullRequest[]> {
  const slug = requireProjectSlug(projectSlug);
  const search = options.search?.trim();
  const path = trackerPath(`/projects/${encodeURIComponent(slug)}/pull_requests`);
  const response =
    search && search.length > 0
      ? await http.get(path, { params: { q: search } })
      : await http.get(path);
  return unwrapData<BackendProjectPullRequestDto[]>(response).map(normalize);
}

function normalize(dto: BackendProjectPullRequestDto): ProjectPullRequest {
  return {
    number: dto.number,
    title: dto.title ?? null,
    url: dto.url ?? null,
    repo: dto.repo ?? null,
    author: dto.author ?? null,
    updatedAt: dto.updated_at ?? dto.updatedAt ?? null,
    issueIdentifier: dto.issue_identifier ?? dto.issueIdentifier ?? null,
  };
}
