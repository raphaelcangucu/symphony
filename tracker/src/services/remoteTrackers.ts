import { http, trackerPath, unwrapData } from "./http";

export interface GitHubProjectSummary {
  id: string;
  number: number;
  title: string;
  owner: { login: string; kind: "user" | "organization" };
  repoNameWithOwner: string | null;
}

export interface LinearProjectSummary {
  id: string;
  slugId: string;
  name: string;
  state: string;
  team: { id: string; name: string };
}

interface GitHubProjectDto {
  id: string;
  number: number;
  title: string;
  owner?: { login?: string | null; kind?: string | null } | null;
  repo_name_with_owner?: string | null;
}

interface LinearProjectDto {
  id: string;
  slugId?: string | null;
  name: string;
  state?: string | null;
  team: { id: string; name: string };
}

export async function discoverGitHubProjects(): Promise<GitHubProjectSummary[]> {
  const response = await http.post(trackerPath("/github/projects/discover"), {});
  return unwrapData<GitHubProjectDto[]>(response).map((dto) => ({
    id: dto.id,
    number: dto.number,
    title: dto.title,
    owner: {
      login: dto.owner?.login ?? "",
      kind: dto.owner?.kind === "organization" ? "organization" : "user",
    },
    repoNameWithOwner: dto.repo_name_with_owner ?? null,
  }));
}

export async function discoverLinearProjects(): Promise<LinearProjectSummary[]> {
  const response = await http.post(trackerPath("/linear/projects/discover"), {});
  return unwrapData<LinearProjectDto[]>(response).map((dto) => ({
    id: dto.id,
    slugId: dto.slugId ?? "",
    name: dto.name,
    state: dto.state ?? "",
    team: { id: dto.team.id, name: dto.team.name },
  }));
}
