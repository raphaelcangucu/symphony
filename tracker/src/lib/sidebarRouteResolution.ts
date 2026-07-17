import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";
import {
  isProjectSection,
  sessionSurfaceFromSearchParams,
} from "@/lib/workspaceRoutes";

export interface SidebarRouteSelection {
  readonly projectSlug: string | null;
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
}

export interface SidebarAncestorIds {
  readonly projectIds: string[];
  readonly workspaceIds: string[];
}

const EMPTY_SELECTION: SidebarRouteSelection = {
  projectSlug: null,
  workspaceId: null,
  sessionId: null,
};

export function resolveSidebarRouteSelection(
  pathname: string,
  search = "",
): SidebarRouteSelection {
  if (typeof pathname !== "string") return { ...EMPTY_SELECTION };
  const splitIndex = pathname.indexOf("?");
  const pathnameOnly = splitIndex === -1 ? pathname : pathname.slice(0, splitIndex);
  const embeddedSearch = splitIndex === -1 ? "" : pathname.slice(splitIndex);
  const normalizedSearch = search || embeddedSearch;
  const rawSegments = pathnameOnly.split("/").filter(Boolean);
  const segments =
    rawSegments[0] === "tracker" ? rawSegments.slice(1) : rawSegments;
  if (segments[0] !== "projects" || segments.length < 3) return { ...EMPTY_SELECTION };

  const projectSlug = safelyDecodeNonBlank(segments[1]);
  const section = safelyDecodeNonBlank(segments[2]);
  if (!projectSlug || !section || (!isProjectSection(section) && section !== "edit")) {
    return { ...EMPTY_SELECTION };
  }

  const base: SidebarRouteSelection = {
    projectSlug,
    workspaceId: null,
    sessionId: null,
  };

  if (section === "workspaces" || section === "sessions") {
    if (segments.length === 4) {
      const threadId = safelyDecodeNonBlank(segments[3]);
      return threadId ? { ...base, sessionId: `thread:${threadId}` } : base;
    }
    if (segments.length !== 3) return base;
    const executionIdentifier = queryParam(normalizedSearch, "exec").value;
    if (!executionIdentifier) return base;
    const surfaceParams = new URLSearchParams();
    const surface = queryParam(normalizedSearch, "surface");
    if (surface.present) {
      if (surface.value) surfaceParams.set("surface", surface.value);
    } else {
      const agent = queryParam(normalizedSearch, "agent").value;
      if (agent) surfaceParams.set("agent", agent);
    }
    // Autonomous/`exec:` nodes are gone — only authoring still uses `?exec=`.
    // Legacy `surface=autonomous` bookmarks redirect to `/workspaces/<threadId>`
    // elsewhere and do not select a synthetic sidebar session.
    if (sessionSurfaceFromSearchParams(surfaceParams) === "autonomous") {
      return base;
    }
    return {
      ...base,
      sessionId: `authoring:${executionIdentifier}`,
    };
  }

  if (section === "assistant" && segments[3] === "issue" && segments.length === 5) {
    const issueIdentifier = safelyDecodeNonBlank(segments[4]);
    return issueIdentifier
      ? { ...base, sessionId: `authoring:${issueIdentifier}` }
      : base;
  }

  return base;
}

export function ancestorIdsForSelection(
  selection: SidebarRouteSelection,
  tree: readonly SidebarProjectNode[],
): SidebarAncestorIds {
  if (!isSelection(selection) || !Array.isArray(tree) || !selection.projectSlug) {
    return { projectIds: [], workspaceIds: [] };
  }

  const matchingProjects = tree.filter(
    (project) =>
      project?.kind === "project" &&
      project.projectSlug === selection.projectSlug &&
      project.id === selection.projectSlug,
  );
  if (matchingProjects.length !== 1) return { projectIds: [], workspaceIds: [] };
  const project = matchingProjects[0];
  const projectOnly: SidebarAncestorIds = {
    projectIds: [project.id],
    workspaceIds: [],
  };
  const workspaces = [...project.workspaces, ...project.overflowWorkspaces];

  if (selection.workspaceId) {
    const matchingWorkspaces = workspaces.filter(
      (workspace) =>
        workspace.id === selection.workspaceId &&
        workspace.projectSlug === project.projectSlug,
    );
    return matchingWorkspaces.length === 1
      ? { projectIds: [project.id], workspaceIds: [matchingWorkspaces[0].id] }
      : projectOnly;
  }

  if (!selection.sessionId) return projectOnly;
  const matches: Array<{ workspace: SidebarWorkspaceNode | null; session: SidebarSessionNode }> = [];
  for (const workspace of workspaces) {
    for (const session of [...workspace.sessions, ...workspace.overflowSessions]) {
      if (
        session.id === selection.sessionId &&
        session.projectSlug === project.projectSlug &&
        session.workspaceId === workspace.id
      ) {
        matches.push({ workspace, session });
      }
    }
  }
  for (const session of project.unassignedSessions) {
    if (
      session.id === selection.sessionId &&
      session.projectSlug === project.projectSlug &&
      session.workspaceId === null
    ) {
      matches.push({ workspace: null, session });
    }
  }

  if (matches.length !== 1) return projectOnly;
  const workspace = matches[0].workspace;
  return {
    projectIds: [project.id],
    workspaceIds: workspace ? [workspace.id] : [],
  };
}

interface ParsedQueryParam {
  readonly present: boolean;
  readonly value: string | null;
}

function queryParam(search: string, key: string): ParsedQueryParam {
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const part of query.split("&")) {
    const separatorIndex = part.indexOf("=");
    const rawKey = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const decodedKey = decodeQueryComponent(rawKey);
    if (decodedKey !== key) continue;
    const rawValue = separatorIndex === -1 ? "" : part.slice(separatorIndex + 1);
    return {
      present: true,
      value: decodeQueryComponent(rawValue)?.trim() || null,
    };
  }
  return { present: false, value: null };
}

function decodeQueryComponent(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

function safelyDecodeNonBlank(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function isSelection(value: unknown): value is SidebarRouteSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<SidebarRouteSelection>;
  return (
    (selection.projectSlug === null || typeof selection.projectSlug === "string") &&
    (selection.workspaceId === null || typeof selection.workspaceId === "string") &&
    (selection.sessionId === null || typeof selection.sessionId === "string")
  );
}
