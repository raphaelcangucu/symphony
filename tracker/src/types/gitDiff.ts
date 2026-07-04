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
