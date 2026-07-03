import { matchesPickerSearch } from "@/lib/pickerOptions";
import {
  assistantPath,
  filtersPath,
  newIssuePath,
  projectSectionPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";
import type { LauncherItem, LauncherTabSpec, QuickAction } from "@/types/launcher";

export const LAUNCHER_TABS: readonly LauncherTabSpec[] = [
  { id: "actions", labelKey: "launcher.tabs.actions" },
  { id: "issues", labelKey: "launcher.tabs.issues" },
  { id: "prs", labelKey: "launcher.tabs.prs" },
  { id: "branches", labelKey: "launcher.tabs.branches" },
];

/** The board view the launcher links into when it cannot infer one from the URL. */
const DEFAULT_LAUNCHER_VIEW: WorkspaceView = "board";

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "new-issue",
    labelKey: "launcher.actions.newIssue",
    run: ({ projectSlug, navigate }) => navigate(newIssuePath(projectSlug, DEFAULT_LAUNCHER_VIEW)),
  },
  {
    id: "go-to-board",
    labelKey: "launcher.actions.goToBoard",
    run: ({ projectSlug, navigate }) => navigate(projectSectionPath(projectSlug, "board")),
  },
  {
    id: "open-filters",
    labelKey: "launcher.actions.openFilters",
    run: ({ projectSlug, navigate }) => navigate(filtersPath(projectSlug, DEFAULT_LAUNCHER_VIEW)),
  },
  {
    id: "search-issues",
    labelKey: "launcher.actions.searchIssues",
    run: ({ projectSlug, navigate }) =>
      navigate(filtersPath(projectSlug, DEFAULT_LAUNCHER_VIEW), { state: { focusSearch: true } }),
  },
  {
    id: "open-assistant",
    labelKey: "launcher.actions.openAssistant",
    run: ({ projectSlug, navigate }) => navigate(assistantPath(projectSlug)),
  },
  {
    id: "open-kb",
    labelKey: "launcher.actions.openKb",
    run: ({ projectSlug, navigate }) => navigate(projectSectionPath(projectSlug, "kb")),
  },
];

/**
 * Fuzzy + exact-number filter. Exact-number lookup is honored because issue/PR
 * number tokens are pushed as standalone `searchTokens` (e.g. "12"), and a pure
 * numeric query matches a token only on equality — so "3" does not match "12".
 */
export function filterLauncherItems(items: LauncherItem[], query: string): LauncherItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  const numeric = /^\d+$/.test(trimmed);

  return items.filter((item) => {
    if (numeric) {
      if (item.searchTokens.some((token) => token === trimmed)) return true;
    }
    return matchesPickerSearch(trimmed, ...item.searchTokens);
  });
}

export type BranchIssueIndex = ReadonlyMap<string, Issue>;

export function buildBranchIssueIndex(issues: Issue[]): BranchIssueIndex {
  const index = new Map<string, Issue>();
  for (const issue of issues) {
    const branch = issue.branchName?.trim();
    if (branch) index.set(branch, issue);
  }
  return index;
}

export function resolveBranchIssue(index: BranchIssueIndex, branchName: string): Issue | undefined {
  return index.get(branchName.trim());
}
