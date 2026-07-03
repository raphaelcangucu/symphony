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
  commitSha?: string | null;
}

export async function listProjectBranches(projectSlug: string): Promise<ProjectBranch[]> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/branches`));
  return unwrapData<BackendProjectBranchDto[]>(response).map(normalize);
}

function normalize(dto: BackendProjectBranchDto): ProjectBranch {
  return {
    name: dto.name,
    repo: dto.repo ?? null,
    protected: dto.protected === true,
    commitSha: dto.commit_sha ?? dto.commitSha ?? null,
  };
}
