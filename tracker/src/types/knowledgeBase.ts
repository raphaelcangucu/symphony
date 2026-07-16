export interface KbRepositorySummary {
  repoSlug: string;
  workspacePath: string;
  githubFullName: string | null;
  defaultBranch: string | null;
  role: string | null;
  docsPresent: boolean;
}

export interface KbTreeNode {
  type: "page" | "folder" | "asset";
  name: string;
  path: string;
  title: string;
  order: number | null;
  favorite: boolean;
  children: KbTreeNode[];
}

export interface KbRepoTree {
  repository: KbRepositorySummary;
  docsPresent: boolean;
  tree: KbTreeNode[];
}

export interface KbProjectOverview {
  project: { slug: string; name: string };
  repositories: KbRepositorySummary[];
}

export interface KbPage {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  markdown: string;
  /** Present when the backend scoped the read to a repository (issue/project KB). */
  repoSlug?: string | null;
}

export interface KbSavePageInput {
  frontmatter?: Record<string, unknown>;
  body: string;
}

export interface KbSaveResult {
  path: string;
  commit: string;
  pushed: boolean;
}

export interface KbSearchResult {
  projectSlug: string;
  repoSlug: string;
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export type KbSyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "open_pr"
  | "merged"
  | "conflict"
  | "checks_failed"
  | "error";

export interface KbSyncState {
  status: KbSyncStatus;
  prNumber: number | null;
  prUrl: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface KbAssetResult {
  assetPath: string;
  markdownLink: string;
}

export interface KbGeneralOverview {
  connected: boolean;
  tree: KbTreeNode[];
}
