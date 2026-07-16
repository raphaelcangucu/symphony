import { GENERAL_KB_PROJECT_SLUG, GENERAL_KB_REPO_SLUG } from "@/lib/kbRoutes";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

/**
 * The contextual scope Maestro binds to on the current screen. `null` (not part
 * of this union) means the docked host must stay off — see `resolveMaestroContext`.
 */
export type MaestroContext =
  | { kind: "home"; surface: "home" | "observability" }
  | { kind: "project"; projectSlug: string; view: WorkspaceView }
  | { kind: "issue"; projectSlug: string; view: WorkspaceView; issueIdentifier: string }
  | { kind: "kb"; projectSlug: string; repoSlug: string; pagePath: string };

const WORKSPACE_OFF = /^\/projects\/[^/]+\/(workspaces|terminal)(\/|$)/;
const FULL_ASSISTANT_OFF = /^\/assistant(\/|$)|^\/projects\/[^/]+\/assistant(\/|$)/;
const ISSUE_DRAWER = /^\/projects\/([^/]+)\/(board|list)\/issues\/([^/]+)(?:\/[^/]+)?\/?$/;
const PROJECT_BOARD_LIST = /^\/projects\/([^/]+)\/(board|list)\/?$/;
const PROJECT_KB = /^\/projects\/([^/]+)\/kb\/([^/]+)\/(.+)$/;
const GENERAL_KB = /^\/kb\/(.+)$/;

function stripQuery(pathname: string): string {
  const path = pathname.split("?")[0];
  return path && path.length > 0 ? path : "/";
}

/**
 * Pure mapping from a router pathname to the Maestro context that the docked
 * host should bind to. Returns `null` on Workspaces, terminal, and full-page
 * assistant routes (host stays off), and on KB roots without a selected page.
 */
export function resolveMaestroContext(pathname: string): MaestroContext | null {
  const path = stripQuery(pathname);

  if (WORKSPACE_OFF.test(path) || FULL_ASSISTANT_OFF.test(path)) return null;

  if (path === "/observability") {
    return { kind: "home", surface: "observability" };
  }
  if (path === "/" || path === "/projects") {
    return { kind: "home", surface: "home" };
  }

  const issue = path.match(ISSUE_DRAWER);
  if (issue) {
    return {
      kind: "issue",
      projectSlug: decodeURIComponent(issue[1]),
      view: issue[2] as WorkspaceView,
      issueIdentifier: decodeURIComponent(issue[3]),
    };
  }

  const board = path.match(PROJECT_BOARD_LIST);
  if (board) {
    return {
      kind: "project",
      projectSlug: decodeURIComponent(board[1]),
      view: board[2] as WorkspaceView,
    };
  }

  const projectKb = path.match(PROJECT_KB);
  if (projectKb) {
    return {
      kind: "kb",
      projectSlug: decodeURIComponent(projectKb[1]),
      repoSlug: decodeURIComponent(projectKb[2]),
      pagePath: decodeURIComponent(projectKb[3]),
    };
  }

  const generalKb = path.match(GENERAL_KB);
  if (generalKb) {
    return {
      kind: "kb",
      projectSlug: GENERAL_KB_PROJECT_SLUG,
      repoSlug: GENERAL_KB_REPO_SLUG,
      pagePath: decodeURIComponent(generalKb[1]),
    };
  }

  return null;
}

/** Stable identity for a context, used to key/remount the docked panel. */
export function maestroContextKey(ctx: MaestroContext): string {
  switch (ctx.kind) {
    case "home":
      return `home:${ctx.surface}`;
    case "project":
      return `project:${ctx.projectSlug}:${ctx.view}`;
    case "issue":
      return `issue:${ctx.projectSlug}:${ctx.issueIdentifier}`;
    case "kb":
      return `kb:${ctx.projectSlug}:${ctx.repoSlug}:${ctx.pagePath}`;
  }
}
