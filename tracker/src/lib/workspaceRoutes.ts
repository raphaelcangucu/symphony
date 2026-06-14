import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

export type WorkspaceView = "board" | "list";

export const ISSUE_TABS = ["summary", "pr", "comments", "evidence", "blockers", "agent", "preview", "activity", "terminal"] as const;

export type IssueTab = (typeof ISSUE_TABS)[number];

export const DEFAULT_ISSUE_TAB: IssueTab = "summary";

export const AGENT_SECTIONS = ["authoring", "execution"] as const;

export type AgentSection = (typeof AGENT_SECTIONS)[number];

export const DEFAULT_AGENT_SECTION: AgentSection = "authoring";

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

export function assistantPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/assistant`;
}

export function projectExploreAssistantPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/assistant/explore`;
}

export function newIssueAssistantPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/assistant/new-issue`;
}

export function issueAssistantPath(projectSlug: string, issueId: string): string {
  const trimmed = normalizeIssueIdentifier(issueId);
  if (!trimmed) throw new Error("identifier is required to build an issue assistant route");
  return `/projects/${requireSlug(projectSlug)}/assistant/issue/${encodeURIComponent(trimmed)}`;
}

export function newIssuePath(projectSlug: string, view: WorkspaceView): string {
  return `${workspaceBasePath(projectSlug, view)}/new-issue`;
}

export function filtersPath(projectSlug: string, view: WorkspaceView): string {
  return `${workspaceBasePath(projectSlug, view)}/filters`;
}

export function projectEditPath(projectSlug: string): string {
  return `${PROJECTS_PATH}/${requireSlug(projectSlug)}/edit`;
}

export const PROJECT_SETTINGS_TABS = ["general", "tracker", "workflow", "dev"] as const;

export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number];

export const DEFAULT_PROJECT_SETTINGS_TAB: ProjectSettingsTab = "general";

/** Old form tabs that now live in the workflow markdown editor. */
const LEGACY_WORKFLOW_SETTINGS_TABS = new Set([
  "states",
  "agent",
  "hooks",
  "workspace",
  "editor",
  "github",
]);

export function isProjectSettingsTab(value: string | undefined | null): value is ProjectSettingsTab {
  return typeof value === "string" && (PROJECT_SETTINGS_TABS as readonly string[]).includes(value);
}

export function resolveProjectSettingsTab(value: string | undefined | null): ProjectSettingsTab {
  if (isProjectSettingsTab(value)) return value;
  if (typeof value === "string" && LEGACY_WORKFLOW_SETTINGS_TABS.has(value)) return "workflow";
  return DEFAULT_PROJECT_SETTINGS_TAB;
}

export function projectSettingsPath(projectSlug: string, tab?: ProjectSettingsTab): string {
  const base = `/projects/${requireSlug(projectSlug)}/settings`;
  return tab && tab !== DEFAULT_PROJECT_SETTINGS_TAB ? `${base}/${tab}` : base;
}

export function issuePath(
  projectSlug: string,
  view: WorkspaceView,
  identifier: string,
  tab: IssueTab = DEFAULT_ISSUE_TAB,
): string {
  const trimmed = normalizeIssueIdentifier(identifier);
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

export function isBoardPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "");
  const marker = "/board";
  const index = normalized.indexOf(marker);
  if (index === -1) return false;
  const after = normalized.slice(index + marker.length);
  return after === "" || after.startsWith("/");
}

export function isAgentSection(value: string | undefined | null): value is AgentSection {
  return typeof value === "string" && (AGENT_SECTIONS as readonly string[]).includes(value);
}

export function agentSectionFromSearchParams(params: URLSearchParams): AgentSection {
  const value = params.get("agent");
  return isAgentSection(value) ? value : DEFAULT_AGENT_SECTION;
}

export function withAgentSection(pathname: string, search: string, section: AgentSection): string {
  const params = new URLSearchParams(search);
  if (section === DEFAULT_AGENT_SECTION) {
    params.delete("agent");
  } else {
    params.set("agent", section);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function issueAgentTabPath(
  projectSlug: string,
  view: WorkspaceView,
  identifier: string,
  section: AgentSection = DEFAULT_AGENT_SECTION,
): string {
  const pathname = issuePath(projectSlug, view, identifier, "agent");
  return withAgentSection(pathname, "", section);
}
