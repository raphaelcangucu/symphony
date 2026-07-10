import type { GitDiffFileChange, GitDiffResult } from "@/types/gitDiff";

const DOCS_PREFIX = "docs/";

/**
 * Collects unique docs-relative paths from an uncommitted multi-repo diff.
 * Git paths are usually `docs/...`; KB tree nodes are docs-relative (no `docs/` prefix).
 */
export function collectChangedDocPaths(diff: GitDiffResult): string[] {
  if (!diff || !Array.isArray(diff.repos)) {
    throw new Error("collectChangedDocPaths: diff.repos is required");
  }

  const paths = new Set<string>();

  for (const repo of diff.repos) {
    if (!repo || !Array.isArray(repo.files)) continue;
    for (const file of repo.files) {
      for (const candidate of fileCandidates(file)) {
        const docsRelative = toDocsRelativePath(candidate);
        if (docsRelative) paths.add(docsRelative);
      }
    }
  }

  return [...paths];
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
