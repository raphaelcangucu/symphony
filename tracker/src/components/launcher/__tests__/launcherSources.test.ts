import { describe, expect, it } from "vitest";

import {
  LAUNCHER_TABS,
  QUICK_ACTIONS,
  buildBranchIssueIndex,
  filterLauncherItems,
  resolveBranchIssue,
} from "@/components/launcher/launcherSources";
import type { LauncherItem } from "@/types/launcher";

const items: LauncherItem[] = [
  { kind: "issues", id: "DEMO-12", title: "Fix login bug", subtitle: "In Progress", searchTokens: ["DEMO-12", "Fix login bug", "12"] },
  { kind: "issues", id: "DEMO-3", title: "Dark mode", subtitle: "Todo", searchTokens: ["DEMO-3", "Dark mode", "3"] },
];

describe("LAUNCHER_TABS", () => {
  it("ships exactly the v1 CORE tabs in order", () => {
    expect(LAUNCHER_TABS.map((t) => t.id)).toEqual(["actions", "issues", "prs", "branches"]);
  });
});

describe("QUICK_ACTIONS", () => {
  it("are data-driven with unique ids and translation keys", () => {
    const ids = QUICK_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(QUICK_ACTIONS.every((a) => a.labelKey.startsWith("launcher.actions."))).toBe(true);
  });
});

describe("filterLauncherItems", () => {
  it("returns all items for a blank query", () => {
    expect(filterLauncherItems(items, "")).toHaveLength(2);
  });

  it("fuzzy-matches against title and identifier", () => {
    expect(filterLauncherItems(items, "login").map((i) => i.id)).toEqual(["DEMO-12"]);
  });

  it("supports exact-number lookup (the issue number suffix)", () => {
    expect(filterLauncherItems(items, "12").map((i) => i.id)).toEqual(["DEMO-12"]);
    expect(filterLauncherItems(items, "3").map((i) => i.id)).toEqual(["DEMO-3"]);
  });
});

describe("branch → issue index", () => {
  it("maps a branch name to the issue whose branchName equals it", () => {
    const index = buildBranchIssueIndex([
      { identifier: "DEMO-12", branchName: "codex/demo-12", title: "Fix login bug" } as never,
      { identifier: "DEMO-3", branchName: null, title: "Dark mode" } as never,
    ]);

    expect(resolveBranchIssue(index, "codex/demo-12")?.identifier).toBe("DEMO-12");
    expect(resolveBranchIssue(index, "feature/orphan")).toBeUndefined();
  });
});
