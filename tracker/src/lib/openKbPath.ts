/** Options when opening a knowledge-base path from a tool card / CreatePlan. */
export interface OpenKbPathOptions {
  /** When set and the page is missing, materialize it in the issue worktree. */
  seedMarkdown?: string | null;
}

export type OpenKbPathHandler = (path: string, options?: OpenKbPathOptions) => void;
