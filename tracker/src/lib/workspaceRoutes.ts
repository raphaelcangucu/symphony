export type WorkspaceView = "board" | "list";

export const ISSUE_TABS = ["summary", "pr", "comments", "blockers", "agent", "preview", "activity", "terminal"] as const;

export type IssueTab = (typeof ISSUE_TABS)[number];

export const DEFAULT_ISSUE_TAB: IssueTab = "summary";

const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["board", "list"];

export function isWorkspaceView(value: string | undefined | null): value is WorkspaceView {
  return value === "board" || value === "list";
}

export function isIssueTab(value: string | undefined | null): value is IssueTab {
  return typeof value === "string" && (ISSUE_TABS as readonly string[]).includes(value);
}

function requireSlug(projectSlug: string): string {
  const trimmed = projectSlug.trim();
  if (!trimmed) throw new Error("projectSlug is required to build a workspace route");
  return encodeURIComponent(trimmed);
}

export function workspaceBasePath(projectSlug: string, view: WorkspaceView): string {
  return `/projects/${requireSlug(projectSlug)}/${view}`;
}

export function newIssuePath(projectSlug: string, view: WorkspaceView): string {
  return `${workspaceBasePath(projectSlug, view)}/new-issue`;
}

export function filtersPath(projectSlug: string, view: WorkspaceView): string {
  return `${workspaceBasePath(projectSlug, view)}/filters`;
}

export function devEnvPath(projectSlug: string, view: WorkspaceView): string {
  return `${workspaceBasePath(projectSlug, view)}/dev-env`;
}

export function issuePath(
  projectSlug: string,
  view: WorkspaceView,
  identifier: string,
  tab: IssueTab = DEFAULT_ISSUE_TAB,
): string {
  const trimmed = identifier.trim();
  if (!trimmed) throw new Error("identifier is required to build an issue route");
  const base = `${workspaceBasePath(projectSlug, view)}/issues/${encodeURIComponent(trimmed)}`;
  return tab === DEFAULT_ISSUE_TAB ? base : `${base}/${tab}`;
}

export const PROJECTS_PATH = "/projects";

export function projectsNewPath(): string {
  return `${PROJECTS_PATH}/new`;
}

export function projectsFiltersPath(): string {
  return `${PROJECTS_PATH}/filters`;
}

export function viewFromPathname(pathname: string): WorkspaceView {
  for (const view of WORKSPACE_VIEWS) {
    if (pathname.includes(`/${view}`)) return view;
  }
  return "board";
}
