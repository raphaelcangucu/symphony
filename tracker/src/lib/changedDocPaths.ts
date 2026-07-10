import type { GitDiffFileChange, GitDiffResult } from "@/types/gitDiff";

const DOCS_PREFIX = "docs/";

export interface ChangedDocEntry {
  /** Diff/repo workspace name (e.g. `back`, `front`). */
  repo: string;
  /** Docs-relative path (no leading `docs/`). */
  path: string;
}

/**
 * Collects unique docs-relative paths from an uncommitted multi-repo diff.
 * Git paths are usually `docs/...`; KB tree nodes are docs-relative (no `docs/` prefix).
 */
export function collectChangedDocPaths(diff: GitDiffResult): string[] {
  return [...new Set(collectChangedDocEntries(diff).map((entry) => entry.path))];
}

/** Same as collectChangedDocPaths, but keeps the owning repo for each path. */
export function collectChangedDocEntries(diff: GitDiffResult): ChangedDocEntry[] {
  if (!diff || !Array.isArray(diff.repos)) {
    throw new Error("collectChangedDocEntries: diff.repos is required");
  }

  const seen = new Set<string>();
  const entries: ChangedDocEntry[] = [];

  for (const repo of diff.repos) {
    if (!repo || !Array.isArray(repo.files)) continue;
    const repoName = typeof repo.repo === "string" ? repo.repo.trim() : "";
    if (!repoName) continue;

    for (const file of repo.files) {
      for (const candidate of fileCandidates(file)) {
        const docsRelative = toDocsRelativePath(candidate);
        if (!docsRelative) continue;
        const key = `${repoName}\0${docsRelative}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ repo: repoName, path: docsRelative });
      }
    }
  }

  return entries;
}

function fileCandidates(file: GitDiffFileChange): string[] {
  const candidates: string[] = [];
  if (typeof file.path === "string" && file.path.trim()) candidates.push(file.path.trim());
  if (typeof file.oldPath === "string" && file.oldPath.trim()) candidates.push(file.oldPath.trim());
  return candidates;
}

function toDocsRelativePath(repoRelativePath: string): string | null {
  const normalized = repoRelativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith(DOCS_PREFIX)) return null;
  const relative = normalized.slice(DOCS_PREFIX.length);
  return relative.length > 0 ? relative : null;
}
