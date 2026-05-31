import { describe, expect, it } from "vitest";

import {
  DEFAULT_ISSUE_TAB,
  devEnvPath,
  filtersPath,
  isIssueTab,
  isWorkspaceView,
  issueAssistantPath,
  issuePath,
  newIssueAssistantPath,
  newIssuePath,
  projectsFiltersPath,
  projectsNewPath,
  viewFromPathname,
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
    expect(devEnvPath("acme", "board")).toBe("/projects/acme/board/dev-env");
  });

  it("builds assistant issue authoring paths", () => {
    expect(newIssueAssistantPath("acme")).toBe("/projects/acme/assistant/new-issue");
    expect(issueAssistantPath("acme", "ABC-1")).toBe("/projects/acme/assistant/issue/ABC-1");
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
    expect(isIssueTab("nope")).toBe(false);
    expect(isIssueTab(undefined)).toBe(false);
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
});
