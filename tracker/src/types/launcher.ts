export type LauncherTabId = "actions" | "issues" | "prs" | "branches";

export interface LauncherTabSpec {
  id: LauncherTabId;
  labelKey: string;
}

/** A normalized, renderable launcher row. `searchTokens` feed fuzzy + exact-number match. */
export interface LauncherItem {
  kind: LauncherTabId;
  /** Stable id: issue identifier, `pr:<repo>#<number>`, branch name, or action id. */
  id: string;
  title: string;
  subtitle?: string | null;
  /** Optional issue identifier this row maps to (PRs/branches → issue-centric action). */
  issueIdentifier?: string | null;
  /** External URL fallback when there is no issue mapping (PR/branch). */
  externalUrl?: string | null;
  searchTokens: string[];
}

export interface QuickAction {
  id: string;
  labelKey: string;
  /** Action handlers receive navigation context resolved in the launcher component. */
  run: (ctx: QuickActionContext) => void;
}

export interface QuickActionContext {
  projectSlug: string;
  navigate: (to: string, options?: { state?: unknown }) => void;
}
