import { requireProjectSlug } from "@/lib/serviceValidation";

const REPO_SLUG_SEPARATOR = "~";

/**
 * Repositories are addressed by a `repo_slug` derived from their workspace path
 * with `/` encoded as `~` (mirrors the Elixir `Paths.repo_slug/1`). The slug is
 * already URL-safe, so it is used verbatim in routes.
 */
export function encodeRepoSlug(workspacePath: string): string {
  return workspacePath.replaceAll("/", REPO_SLUG_SEPARATOR);
}

export function decodeRepoSlug(repoSlug: string): string {
  return repoSlug.replaceAll(REPO_SLUG_SEPARATOR, "/");
}

function encodePagePath(pagePath: string): string {
  return pagePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export function kbProjectPath(projectSlug: string): string {
  return `/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/kb`;
}

export function kbRepoPath(projectSlug: string, repoSlug: string): string {
  return `${kbProjectPath(projectSlug)}/${repoSlug}`;
}

export function kbPagePath(projectSlug: string, repoSlug: string, pagePath: string): string {
  return `${kbRepoPath(projectSlug, repoSlug)}/${encodePagePath(pagePath)}`;
}

export function kbGeneralPath(): string {
  return "/kb";
}

export function kbGeneralPagePath(pagePath: string): string {
  return `/kb/${encodePagePath(pagePath)}`;
}
