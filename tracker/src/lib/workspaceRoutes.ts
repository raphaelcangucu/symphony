import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

export type WorkspaceView = "board" | "list";

export const ISSUE_TABS = ["summary", "pr", "comments", "evidence", "sessions", "preview", "activity", "terminal"] as const;

export type IssueTab = (typeof ISSUE_TABS)[number];

export const DEFAULT_ISSUE_TAB: IssueTab = "summary";

export const SESSION_SURFACES = ["session", "autonomous"] as const;

export type SessionSurface = (typeof SESSION_SURFACES)[number];

export const DEFAULT_SESSION_SURFACE: SessionSurface = "session";

/** @deprecated Prefer SessionSurface. Kept for legacy URL/API aliases. */
export const AGENT_SECTIONS = ["authoring", "execution"] as const;

/** @deprecated Prefer SessionSurface */
export type AgentSection = (typeof AGENT_SECTIONS)[number];

/** @deprecated Prefer DEFAULT_SESSION_SURFACE */
export const DEFAULT_AGENT_SECTION: AgentSection = "authoring";

const SURFACE_ALIASES: Record<string, SessionSurface> = {
  session: "session",
  autonomous: "autonomous",
  authoring: "session",
  execution: "autonomous",
  plan: "session",
};

export function isSessionSurface(value: string | undefined | null): value is SessionSurface {
  return typeof value === "string" && (SESSION_SURFACES as readonly string[]).includes(value);
}

export function normalizeSessionSurface(value: string | undefined | null): SessionSurface {
  if (!value) return DEFAULT_SESSION_SURFACE;
  return SURFACE_ALIASES[value.trim().toLowerCase()] ?? DEFAULT_SESSION_SURFACE;
}

export function isAgentSection(value: string | undefined | null): value is AgentSection {
  return typeof value === "string" && (AGENT_SECTIONS as readonly string[]).includes(value);
}

export function agentSectionFromSearchParams(params: URLSearchParams): AgentSection {
  const surface = sessionSurfaceFromSearchParams(params);
  return surface === "autonomous" ? "execution" : "authoring";
}

export function sessionSurfaceFromSearchParams(params: URLSearchParams): SessionSurface {
  const surface = params.get("surface");
  if (surface) return normalizeSessionSurface(surface);
  const agent = params.get("agent");
  return normalizeSessionSurface(agent);
}

export function withSessionSurface(pathname: string, search: string, surface: SessionSurface): string {
  const params = new URLSearchParams(search);
  // Prefer modern `surface=` while clearing legacy `agent=`.
  params.delete("agent");
  if (surface === DEFAULT_SESSION_SURFACE) {
    params.delete("surface");
  } else {
    params.set("surface", surface);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function withAgentSection(pathname: string, search: string, section: AgentSection): string {
  return withSessionSurface(pathname, search, section === "execution" ? "autonomous" : "session");
}

/**
 * Deep-linkable URL for an issue-bound interactive session opened inline on the
 * Workspaces page. Prefer `surface=session`; legacy `agent=authoring` still works.
 */
export function projectAuthoringSessionPath(projectSlug: string, issueIdentifier: string): string {
  return projectSessionSurfacePath(projectSlug, issueIdentifier, "session");
}

/**
 * Path to an orchestrator `issue_execution` session. Prefer a real thread id —
 * never emit the legacy `?exec=&surface=autonomous` query destination.
 * Without a session id, fall back to the project workspaces list.
 */
export function projectExecutionSessionPath(
  projectSlug: string,
  _issueIdentifier: string,
  executionSessionId?: number | null,
): string {
  if (executionSessionId != null && Number.isInteger(executionSessionId) && executionSessionId > 0) {
    return projectSessionPath(projectSlug, executionSessionId);
  }
  return projectSessionsPath(projectSlug);
}

export function projectSessionSurfacePath(
  projectSlug: string,
  issueIdentifier: string,
  surface: SessionSurface,
): string {
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  const params = new URLSearchParams();
  params.set("exec", identifier);
  if (surface !== DEFAULT_SESSION_SURFACE) {
    params.set("surface", surface);
  }
  return `${projectSessionsPath(projectSlug)}?${params.toString()}`;
}

export function issueAgentTabPath(
  projectSlug: string,
  view: WorkspaceView,
  identifier: string,
  section: AgentSection | SessionSurface = "session",
): string {
  const pathname = issuePath(projectSlug, view, identifier, "sessions");
  const surface = normalizeSessionSurface(section);
  return withSessionSurface(pathname, "", surface);
}

const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["board", "list"];

export function isWorkspaceView(value: string | undefined | null): value is WorkspaceView {
  return value === "board" || value === "list";
}

export function isIssueTab(value: string | undefined | null): value is IssueTab {
  return typeof value === "string" && (ISSUE_TABS as readonly string[]).includes(value);
}

/** Issue drawer tabs that are no longer exposed in the UI but may still appear in old links. */
const HIDDEN_ISSUE_TABS = new Set(["blockers", "agent"]);

export function isHiddenIssueTab(value: string | undefined | null): boolean {
  return typeof value === "string" && HIDDEN_ISSUE_TABS.has(value);
}

export function resolveIssueTab(value: string | undefined | null): IssueTab {
  if (value === "agent") return "sessions";
  if (isIssueTab(value)) return value;
  return DEFAULT_ISSUE_TAB;
}

function requireSlug(projectSlug: string): string {
  return encodeURIComponent(requireProjectSlug(projectSlug));
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

/**
 * The Workspaces page is the evolution of the old Sessions page: same tabbed
 * surface, but grouped by working tree. Legacy `/sessions` URLs redirect here.
 */
export function projectSessionsPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/workspaces`;
}

export const projectWorkspacesPath = projectSessionsPath;

export function projectTerminalPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/terminal`;
}

export function projectSessionPath(projectSlug: string, threadId: number | string): string {
  const id = encodeURIComponent(requireNonBlank(String(threadId), "threadId"));
  return `${projectSessionsPath(projectSlug)}/${id}`;
}

/** Deep link that opens the ephemeral new-issue authoring tab on Workspaces. */
export function projectNewIssueWorkspacePath(projectSlug: string): string {
  return `${projectSessionsPath(projectSlug)}?new=1`;
}

/** Entry path for “new issue with assistant” — hosted on Workspaces (`?new=1`). */
export function newIssueAssistantPath(projectSlug: string): string {
  return projectNewIssueWorkspacePath(projectSlug);
}

/** Legacy path retained for redirects into `projectAuthoringSessionPath`. */
export function issueAssistantPath(projectSlug: string, issueId: string): string {
  const trimmed = requireNonBlank(normalizeIssueIdentifier(issueId), "identifier");
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

export const PROJECT_SETTINGS_TABS = ["general", "tracker", "workflow", "dev", "integrations"] as const;

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
  const trimmed = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");
  const base = `${workspaceBasePath(projectSlug, view)}/issues/${encodeURIComponent(trimmed)}`;
  return tab === DEFAULT_ISSUE_TAB ? base : `${base}/${tab}`;
}

export const PROJECTS_PATH = "/projects";

/** Top-level workspace sections reachable from the project header. */
export const PROJECT_SECTIONS = ["board", "list", "workspaces", "sessions", "terminal", "assistant", "settings", "kb"] as const;

export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export const DEFAULT_PROJECT_SECTION: ProjectSection = "board";

export function isProjectSection(value: string | undefined | null): value is ProjectSection {
  return typeof value === "string" && (PROJECT_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolves the active workspace section from a pathname so switching projects
 * can keep the user on the same view. Deep sub-paths (issue drawers, KB pages,
 * settings tabs) are intentionally dropped because they are project-specific.
 */
export function projectSectionFromPathname(pathname: string): ProjectSection {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "projects") return DEFAULT_PROJECT_SECTION;
  return isProjectSection(segments[2]) ? segments[2] : DEFAULT_PROJECT_SECTION;
}

export function projectSectionPath(projectSlug: string, section: ProjectSection): string {
  return `/projects/${requireSlug(projectSlug)}/${section}`;
}

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
