import type {
  KbAssetResult,
  KbGeneralOverview,
  KbPage,
  KbProjectOverview,
  KbRepoTree,
  KbRepositorySummary,
  KbSavePageInput,
  KbSaveResult,
  KbSearchResult,
  KbSyncState,
  KbTreeNode,
} from "@/types/knowledgeBase";

import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

interface RepoDto {
  repo_slug: string;
  workspace_path: string;
  github_full_name: string | null;
  role: string | null;
  // Overview emits an Elixir map key with a trailing `?`.
  "docs_present?"?: boolean;
  docs_present?: boolean;
}

interface TreeDto {
  type: "page" | "folder";
  name: string;
  path: string;
  title: string;
  order: number | null;
  children: TreeDto[];
}

interface PageDto {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  content: string;
}

interface SaveResultDto {
  path: string;
  commit: string;
  pushed: boolean;
}

interface SearchResultDto {
  project_slug: string;
  repo_slug: string;
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

interface SyncStateDto {
  status: KbSyncState["status"];
  pr_number: number | null;
  pr_url: string | null;
  last_error: string | null;
  last_synced_at: string | null;
}

function mapRepo(dto: RepoDto): KbRepositorySummary {
  return {
    repoSlug: dto.repo_slug,
    workspacePath: dto.workspace_path,
    githubFullName: dto.github_full_name ?? null,
    role: dto.role ?? null,
    docsPresent: dto["docs_present?"] ?? dto.docs_present ?? false,
  };
}

function mapTree(dto: TreeDto): KbTreeNode {
  return {
    type: dto.type,
    name: dto.name,
    path: dto.path,
    title: dto.title,
    order: dto.order ?? null,
    children: (dto.children ?? []).map(mapTree),
  };
}

function mapPage(dto: PageDto): KbPage {
  return {
    path: dto.path,
    title: dto.title,
    frontmatter: dto.frontmatter ?? {},
    body: dto.body ?? "",
    markdown: dto.content ?? "",
  };
}

function mapSyncState(dto: SyncStateDto): KbSyncState {
  return {
    status: dto.status,
    prNumber: dto.pr_number,
    prUrl: dto.pr_url,
    lastError: dto.last_error,
    lastSyncedAt: dto.last_synced_at,
  };
}

function encodePagePath(pagePath: string): string {
  return pagePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

function base(projectSlug: string): string {
  return `/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/kb`;
}

function repoBase(projectSlug: string, repoSlug: string): string {
  return `${base(projectSlug)}/repos/${repoSlug}`;
}

export async function getProjectOverview(projectSlug: string): Promise<KbProjectOverview> {
  const response = await http.get(trackerPath(base(projectSlug)));
  const data = unwrapData<{ project: { slug: string; name: string }; repositories: RepoDto[] }>(response);
  return { project: data.project, repositories: (data.repositories ?? []).map(mapRepo) };
}

export async function getRepoTree(projectSlug: string, repoSlug: string): Promise<KbRepoTree> {
  const response = await http.get(trackerPath(repoBase(projectSlug, repoSlug)));
  const data = unwrapData<{ repository: RepoDto; docs_present: boolean; tree: TreeDto[] }>(response);
  const repository = { ...mapRepo(data.repository), docsPresent: data.docs_present };
  return { repository, docsPresent: data.docs_present, tree: (data.tree ?? []).map(mapTree) };
}

export async function getPage(projectSlug: string, repoSlug: string, path: string): Promise<KbPage> {
  const response = await http.get(trackerPath(`${repoBase(projectSlug, repoSlug)}/pages/${encodePagePath(path)}`));
  return mapPage(unwrapData<PageDto>(response));
}

export async function savePage(
  projectSlug: string,
  repoSlug: string,
  path: string,
  input: KbSavePageInput,
): Promise<KbSaveResult> {
  const response = await http.put(trackerPath(`${repoBase(projectSlug, repoSlug)}/pages/${encodePagePath(path)}`), {
    frontmatter: input.frontmatter ?? {},
    body: input.body,
  });
  return unwrapData<SaveResultDto>(response);
}

export async function movePage(
  projectSlug: string,
  repoSlug: string,
  from: string,
  to: string,
): Promise<KbSaveResult> {
  const response = await http.post(trackerPath(`${repoBase(projectSlug, repoSlug)}/move`), { from, to });
  return unwrapData<SaveResultDto>(response);
}

export async function deletePage(projectSlug: string, repoSlug: string, path: string): Promise<KbSaveResult> {
  const response = await http.delete(trackerPath(`${repoBase(projectSlug, repoSlug)}/pages/${encodePagePath(path)}`));
  return unwrapData<SaveResultDto>(response);
}

export async function uploadAsset(
  projectSlug: string,
  repoSlug: string,
  file: File,
  pagePath: string,
): Promise<KbAssetResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("page_path", pagePath);
  const response = await http.post(trackerPath(`${repoBase(projectSlug, repoSlug)}/assets`), form);
  const data = unwrapData<{ asset_path: string; markdown_link: string }>(response);
  return { assetPath: data.asset_path, markdownLink: data.markdown_link };
}

export async function searchProject(
  projectSlug: string,
  q: string,
  options: { repo?: string } = {},
): Promise<KbSearchResult[]> {
  const params: Record<string, string> = { q };
  if (options.repo) params.repo = options.repo;
  const response = await http.get(trackerPath(`${base(projectSlug)}/search`), { params });
  return unwrapData<SearchResultDto[]>(response).map((r) => ({
    projectSlug: r.project_slug,
    repoSlug: r.repo_slug,
    path: r.path,
    title: r.title,
    snippet: r.snippet,
    rank: r.rank,
  }));
}

export async function getSyncStatus(projectSlug: string, repoSlug: string): Promise<KbSyncState> {
  const response = await http.get(trackerPath(`${repoBase(projectSlug, repoSlug)}/sync`));
  return mapSyncState(unwrapData<SyncStateDto>(response));
}

export async function requestSync(projectSlug: string, repoSlug: string): Promise<void> {
  await http.post(trackerPath(`${repoBase(projectSlug, repoSlug)}/sync`));
}

// --- General (personal) KB ---

export async function getGeneralOverview(): Promise<KbGeneralOverview> {
  const response = await http.get(trackerPath("/kb"));
  const data = unwrapData<{ connected: boolean; tree: TreeDto[] }>(response);
  return { connected: data.connected, tree: (data.tree ?? []).map(mapTree) };
}

export async function connectGeneral(): Promise<void> {
  await http.post(trackerPath("/kb/connect"));
}

export async function getGeneralPage(path: string): Promise<KbPage> {
  const response = await http.get(trackerPath(`/kb/pages/${encodePagePath(path)}`));
  return mapPage(unwrapData<PageDto>(response));
}

export async function saveGeneralPage(path: string, input: KbSavePageInput): Promise<KbSaveResult> {
  const response = await http.put(trackerPath(`/kb/pages/${encodePagePath(path)}`), {
    frontmatter: input.frontmatter ?? {},
    body: input.body,
  });
  return unwrapData<SaveResultDto>(response);
}

export async function regenerateGeneralHome(): Promise<KbSaveResult> {
  const response = await http.post(trackerPath("/kb/home"));
  return unwrapData<SaveResultDto>(response);
}

export async function searchGeneral(q: string): Promise<KbSearchResult[]> {
  const response = await http.get(trackerPath("/kb/search"), { params: { q } });
  return unwrapData<SearchResultDto[]>(response).map((r) => ({
    projectSlug: r.project_slug,
    repoSlug: r.repo_slug,
    path: r.path,
    title: r.title,
    snippet: r.snippet,
    rank: r.rank,
  }));
}
