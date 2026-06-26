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

/**
 * Turns a human title into a file-name base that satisfies the backend path
 * segment rule (`^[a-zA-Z0-9._-]+$`): lowercased, accents stripped, and any
 * run of unsupported characters collapsed to a single hyphen.
 */
export function slugifyPageName(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug || "untitled";
}

/**
 * Returns a `.md` file name within `dir` that does not collide with any path in
 * `existingPaths`, appending `-2`, `-3`, … when needed.
 */
export function uniquePagePath(existingPaths: Iterable<string>, dir: string, title: string): string {
  const taken = new Set(existingPaths);
  const base = slugifyPageName(title);
  const prefix = dir ? `${dir}/` : "";
  let candidate = `${prefix}${base}.md`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${prefix}${base}-${counter}.md`;
    counter += 1;
  }
  return candidate;
}
