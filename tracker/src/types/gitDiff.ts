export type GitDiffType = "branch" | "uncommitted";

export interface GitDiffWorkspace {
  path: string;
  available: boolean;
}

export interface GitDiffFileChange {
  path: string;
  oldPath: string | null;
  status: string;
  patch: string;
}

export interface GitDiffRepo {
  repo: string;
  branch?: string | null;
  base?: string | null;
  ahead?: number | null;
  behind?: number | null;
  files: GitDiffFileChange[];
}

export interface GitDiffResult {
  repos: GitDiffRepo[];
  workspace: GitDiffWorkspace;
}

export interface GitDiffCommitResult {
  repo: string;
  sha: string;
  message: string;
  files: string[];
}

export interface GitDiffCommitResponse {
  commits: GitDiffCommitResult[];
  workspace: GitDiffWorkspace;
}

export interface GitDiffRepoSummary {
  repo: string;
  branch: string | null;
  aheadCount: number;
  dirty: boolean;
}

export interface GitDiffSummariesResult {
  summaries: GitDiffRepoSummary[];
  workspace: GitDiffWorkspace;
}

export interface GitDiffPushResult {
  repo: string;
  ok: boolean;
  error?: string;
}

export interface GitDiffPushResponse {
  results: GitDiffPushResult[];
  workspace: GitDiffWorkspace;
}

/** Aggregate per-repo counters from the `/diff/stats` endpoint — no file list, no patches. */
export interface GitDiffRepoStat {
  repo: string;
  branch: string | null;
  base: string | null;
  filesChanged: number;
  additions: number;
  deletions: number;
  untracked: number;
}

export interface GitDiffStatsResult {
  stats: GitDiffRepoStat[];
  workspace: GitDiffWorkspace;
}

/** One row from the paginated `/diff/files` list — metadata only, no patch. */
export interface GitDiffFileEntry {
  repo: string;
  path: string;
  oldPath: string | null;
  status: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface GitDiffFilesPage {
  files: GitDiffFileEntry[];
  total: number;
  limit: number;
  nextCursor: string | null;
  workspace: GitDiffWorkspace;
}

/** The unified patch for exactly one file, from the `/diff/patch` endpoint. */
export interface GitDiffPatchResult {
  repo: string;
  path: string;
  status: string;
  binary: boolean;
  truncated: boolean;
  patch: string;
  workspace: GitDiffWorkspace;
}

/**
 * Shape shared by everything `GitDiffFileTree` can render: either a fully
 * loaded `GitDiffFileChange` (patch present, stats derived from it) or a
 * lightweight `GitDiffFileEntry` (additions/deletions known up front, patch
 * loaded later on demand). Both types are structurally assignable to this.
 */
export interface GitDiffFileTreeEntry {
  path: string;
  oldPath: string | null;
  status: string;
  patch?: string;
  additions?: number | null;
  deletions?: number | null;
  binary?: boolean;
}
