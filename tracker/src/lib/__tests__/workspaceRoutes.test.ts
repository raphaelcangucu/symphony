import { describe, expect, it } from "vitest";

import {
  agentSectionFromSearchParams,
  DEFAULT_ISSUE_TAB,
  filtersPath,
  isHiddenIssueTab,
  isIssueTab,
  isBoardPath,
  isProjectSection,
  projectSectionFromPathname,
  projectSectionPath,
  resolveIssueTab,
  isWorkspaceView,
  issueAgentTabPath,
  issueAssistantPath,
  issuePath,
  newIssueAssistantPath,
  projectExploreAssistantPath,
  newIssuePath,
  projectsFiltersPath,
  projectsNewPath,
  viewFromPathname,
  withAgentSection,
  workspaceBasePath,
} from "@/lib/workspaceRoutes";

describe("workspaceRoutes", () => {
  it("builds the base path for each view", () => {
    expect(workspaceBasePath("acme", "board")).toBe("/projects/acme/board");
    expect(workspaceBasePath("acme", "list")).toBe("/projects/acme/list");
  });

  it("encodes slugs with special characters", () => {
    expect(workspaceBasePath("a/b c", "board")).toBe("/projects/a%2Fb%20c/board");
  });

  it("rejects empty slugs", () => {
    expect(() => workspaceBasePath("  ", "board")).toThrow(/projectSlug is required/);
  });

  it("builds modal paths", () => {
    expect(newIssuePath("acme", "board")).toBe("/projects/acme/board/new-issue");
    expect(filtersPath("acme", "list")).toBe("/projects/acme/list/filters");
  });

  it("builds assistant issue authoring paths", () => {
    expect(newIssueAssistantPath("acme")).toBe("/projects/acme/assistant/new-issue");
    expect(issueAssistantPath("acme", "ABC-1")).toBe("/projects/acme/assistant/issue/ABC-1");
    expect(projectExploreAssistantPath("acme")).toBe("/projects/acme/assistant/explore");
  });

  it("encodes assistant issue authoring path parameters", () => {
    expect(newIssueAssistantPath("a/b c")).toBe("/projects/a%2Fb%20c/assistant/new-issue");
    expect(issueAssistantPath("acme", "#508")).toBe("/projects/acme/assistant/issue/508");
  });

  it("omits the default tab from the issue path but keeps explicit tabs", () => {
    expect(issuePath("acme", "board", "ABC-1")).toBe("/projects/acme/board/issues/ABC-1");
    expect(issuePath("acme", "board", "ABC-1", DEFAULT_ISSUE_TAB)).toBe("/projects/acme/board/issues/ABC-1");
    expect(issuePath("acme", "board", "ABC-1", "comments")).toBe("/projects/acme/board/issues/ABC-1/comments");
    expect(issuePath("acme", "board", "ABC-1", "preview")).toBe("/projects/acme/board/issues/ABC-1/preview");
  });

  it("strips a leading hash when building GitHub issue paths", () => {
    expect(issuePath("macro-markets", "board", "#508", "agent")).toBe(
      "/projects/macro-markets/board/issues/508/agent",
    );
  });

  it("requires an identifier for issue paths", () => {
    expect(() => issuePath("acme", "board", "")).toThrow(/identifier is required/);
  });

  it("builds project-index modal paths", () => {
    expect(projectsNewPath()).toBe("/projects/new");
    expect(projectsFiltersPath()).toBe("/projects/filters");
  });

  it("validates issue tabs", () => {
    expect(isIssueTab("comments")).toBe(true);
    expect(isIssueTab("preview")).toBe(true);
    expect(isIssueTab("blockers")).toBe(false);
    expect(isIssueTab("nope")).toBe(false);
    expect(isIssueTab(undefined)).toBe(false);
  });

  it("resolves hidden issue tabs to the default tab", () => {
    expect(isHiddenIssueTab("blockers")).toBe(true);
    expect(isHiddenIssueTab("comments")).toBe(false);
    expect(resolveIssueTab("blockers")).toBe(DEFAULT_ISSUE_TAB);
    expect(resolveIssueTab("comments")).toBe("comments");
  });

  it("validates workspace views", () => {
    expect(isWorkspaceView("board")).toBe(true);
    expect(isWorkspaceView("list")).toBe(true);
    expect(isWorkspaceView("grid")).toBe(false);
  });

  it("derives the view from a pathname", () => {
    expect(viewFromPathname("/projects/acme/board/issues/ABC-1")).toBe("board");
    expect(viewFromPathname("/projects/acme/list/filters")).toBe("list");
    expect(viewFromPathname("/projects/acme")).toBe("board");
  });

  it("validates project sections", () => {
    expect(isProjectSection("board")).toBe(true);
    expect(isProjectSection("kb")).toBe(true);
    expect(isProjectSection("assistant")).toBe(true);
    expect(isProjectSection("settings")).toBe(true);
    expect(isProjectSection("new-issue")).toBe(false);
    expect(isProjectSection(undefined)).toBe(false);
  });

  it("derives the workspace section from a pathname", () => {
    expect(projectSectionFromPathname("/projects/acme/board/issues/ABC-1")).toBe("board");
    expect(projectSectionFromPathname("/projects/acme/list/filters")).toBe("list");
    expect(projectSectionFromPathname("/projects/acme/kb/repo/page")).toBe("kb");
    expect(projectSectionFromPathname("/projects/acme/assistant/explore")).toBe("assistant");
    expect(projectSectionFromPathname("/projects/acme/settings/workflow")).toBe("settings");
    expect(projectSectionFromPathname("/projects/acme")).toBe("board");
    expect(projectSectionFromPathname("/kb/page")).toBe("board");
  });

  it("builds a section path for a project", () => {
    expect(projectSectionPath("acme", "kb")).toBe("/projects/acme/kb");
    expect(projectSectionPath("a/b c", "board")).toBe("/projects/a%2Fb%20c/board");
  });

  it("detects board paths only", () => {
    expect(isBoardPath("/projects/acme/board")).toBe(true);
    expect(isBoardPath("/projects/acme/board/issues/ABC-1")).toBe(true);
    expect(isBoardPath("/projects/acme/list/filters")).toBe(false);
    expect(isBoardPath("/projects/acme/list")).toBe(false);
    expect(isBoardPath("/projects/acme/settings")).toBe(false);
    expect(isBoardPath("/projects/acme/settings/workflow")).toBe(false);
    expect(isBoardPath("/projects/acme/assistant")).toBe(false);
    expect(isBoardPath("/projects/acme/assistant/explore")).toBe(false);
  });

  it("builds the issue agent tab path with an optional section", () => {
    expect(issueAgentTabPath("macro-markets", "board", "510")).toBe("/projects/macro-markets/board/issues/510/agent");
    expect(issueAgentTabPath("macro-markets", "board", "510", "execution")).toBe(
      "/projects/macro-markets/board/issues/510/agent?agent=execution",
    );
  });

  it("reads and writes the agent sub-tab search param", () => {
    expect(agentSectionFromSearchParams(new URLSearchParams())).toBe("authoring");
    expect(agentSectionFromSearchParams(new URLSearchParams("agent=execution"))).toBe("execution");
    expect(withAgentSection("/projects/acme/board/issues/1/agent", "", "execution")).toBe(
      "/projects/acme/board/issues/1/agent?agent=execution",
    );
    expect(withAgentSection("/projects/acme/board/issues/1/agent", "q=test", "execution")).toBe(
      "/projects/acme/board/issues/1/agent?q=test&agent=execution",
    );
    expect(withAgentSection("/projects/acme/board/issues/1/agent", "agent=execution", "authoring")).toBe(
      "/projects/acme/board/issues/1/agent",
    );
  });
});
