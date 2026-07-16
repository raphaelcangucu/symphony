import type { GitDiffFileEntry } from "@/types/gitDiff";

/** Normalize path separators and strip a leading slash for comparison. */
export function normalizeGitDiffPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function gitDiffPathBaseName(path: string): string {
  const normalized = normalizeGitDiffPath(path);
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

/**
 * Find file-list entries that correspond to a tool-reported edited path
 * (absolute workspace path, repo-prefixed path, or repo-relative path).
 */
export function findGitDiffEntriesForPath(
  entries: GitDiffFileEntry[],
  editedPath: string,
): GitDiffFileEntry[] {
  const normalizedEditedPath = normalizeGitDiffPath(editedPath);
  if (!normalizedEditedPath) return [];

  const matches: GitDiffFileEntry[] = [];
  for (const entry of entries) {
    const repoPath = normalizeGitDiffPath(entry.repo ? `${entry.repo}/${entry.path}` : entry.path);
    const filePath = normalizeGitDiffPath(entry.path);

    if (
      normalizedEditedPath === repoPath ||
      normalizedEditedPath === filePath ||
      normalizedEditedPath.endsWith(`/${repoPath}`) ||
      normalizedEditedPath.endsWith(`/${filePath}`)
    ) {
      matches.push(entry);
    }
  }

  return matches;
}

/**
 * Prefer the most specific (longest) path match. Returns null when empty.
 */
export function pickBestGitDiffEntry(
  entries: GitDiffFileEntry[],
  editedPath: string,
): GitDiffFileEntry | null {
  const matches = findGitDiffEntriesForPath(entries, editedPath);
  if (matches.length === 0) return null;

  return [...matches].sort((left, right) => {
    const leftLen = normalizeGitDiffPath(left.repo ? `${left.repo}/${left.path}` : left.path).length;
    const rightLen = normalizeGitDiffPath(right.repo ? `${right.repo}/${right.path}` : right.path).length;
    return rightLen - leftLen;
  })[0] ?? null;
}
