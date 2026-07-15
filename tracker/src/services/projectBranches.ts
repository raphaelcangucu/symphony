import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

export interface ProjectBranch {
  name: string;
  repo: string | null;
  protected: boolean;
  commitSha: string | null;
}

interface BackendProjectBranchDto {
  name: string;
  repo?: string | null;
  protected?: boolean | null;
  commit_sha?: string | null;
}

export interface ListProjectBranchesOptions {
  /** Prefix/search query — uses GitHub matching-refs when long enough. */
  query?: string;
}

export async function listProjectBranches(
  projectSlug: string,
  options: ListProjectBranchesOptions = {},
): Promise<ProjectBranch[]> {
  const slug = requireProjectSlug(projectSlug);
  const query = options.query?.trim();
  const path =
    query && query.length > 0
      ? trackerPath(`/projects/${encodeURIComponent(slug)}/branches?q=${encodeURIComponent(query)}`)
      : trackerPath(`/projects/${encodeURIComponent(slug)}/branches`);
  const response = await http.get(path);
  return unwrapData<BackendProjectBranchDto[]>(response).map(normalize);
}

function normalize(dto: BackendProjectBranchDto): ProjectBranch {
  return {
    name: dto.name,
    repo: dto.repo ?? null,
    protected: dto.protected === true,
    commitSha: dto.commit_sha ?? null,
  };
}
