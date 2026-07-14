const DEFAULT_BRANCH = "main";

function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Builds a GitHub blob URL for a KB page stored under `docs/` in the repository.
 * Returns null when the repository is not linked to GitHub.
 */
export function buildKbGitHubFileUrl(
  githubFullName: string | null | undefined,
  pagePath: string,
  branch: string | null | undefined = DEFAULT_BRANCH,
): string | null {
  const repo = githubFullName?.trim();
  if (!repo || !pagePath.trim()) return null;

  const ref = branch?.trim() || DEFAULT_BRANCH;
  return `https://github.com/${repo}/blob/${encodeURIComponent(ref)}/docs/${encodeRepoPath(pagePath)}`;
}
