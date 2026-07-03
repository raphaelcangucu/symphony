import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLauncherData } from "@/components/launcher/useLauncherData";
import * as issuesService from "@/services/issues";
import * as prService from "@/services/projectPullRequests";
import * as branchService from "@/services/projectBranches";

vi.mock("@/hooks/useAgentExecutions", () => ({
  useAgentExecutions: () => ({
    executions: new Map([["DEMO-12", { issueIdentifier: "DEMO-12", status: "live" }]]),
    refetch: vi.fn(),
  }),
}));

describe("useLauncherData", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns issue items with a live status when the issues tab is open", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: "codex/demo-12" } as never,
    ]);

    const { result } = renderHook(() =>
      useLauncherData({ projectSlug: "demo", open: true, activeTab: "issues", query: "" }),
    );

    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.items[0]).toMatchObject({
      kind: "issues",
      id: "DEMO-12",
      issueIdentifier: "DEMO-12",
      status: "live",
    });
    expect(result.current.loading).toBe(false);
  });

  it("joins branches to issues via branchName and falls back to an external url", async () => {
    vi.spyOn(branchService, "listProjectBranches").mockResolvedValue([
      { name: "codex/demo-12", repo: "o/r", protected: false, commitSha: "a" },
      { name: "feature/orphan", repo: "o/r", protected: false, commitSha: "b" },
    ]);
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: "codex/demo-12" } as never,
    ]);

    const { result } = renderHook(() =>
      useLauncherData({ projectSlug: "demo", open: true, activeTab: "branches", query: "" }),
    );

    await waitFor(() => expect(result.current.items.length).toBe(2));
    const mapped = result.current.items.find((i) => i.id === "codex/demo-12");
    const orphan = result.current.items.find((i) => i.id === "feature/orphan");
    expect(mapped?.issueIdentifier).toBe("DEMO-12");
    expect(orphan?.issueIdentifier).toBeNull();
    expect(orphan?.externalUrl).toBe("https://github.com/o/r/tree/feature/orphan");
  });

  it("does not fetch PRs while the PRs tab is closed", () => {
    const spy = vi.spyOn(prService, "listProjectPullRequests").mockResolvedValue([]);
    renderHook(() => useLauncherData({ projectSlug: "demo", open: false, activeTab: "prs", query: "" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
