import { describe, expect, it } from "vitest";

import { applyIssueFilters, filtersFromSearchParams, type IssueFilters } from "@/lib/issueFilters";
import type { Issue } from "@/types/issue";

function issueFixture(overrides: Partial<Issue>): Issue {
  return {
    id: "1",
    identifier: "AB-1",
    projectSlug: "demo",
    status: "Todo",
    title: "Sample",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("filtersFromSearchParams", () => {
  it("reads supported keys and trims values", () => {
    const params = new URLSearchParams({ q: " login ", assignee: "me", creator: "octocat", foo: "bar" });

    expect(filtersFromSearchParams(params)).toEqual<IssueFilters>({
      search: "login",
      assignee: "me",
      creator: "octocat",
    });
  });

  it("omits empty values", () => {
    const params = new URLSearchParams({ q: "  ", assignee: "" });
    expect(filtersFromSearchParams(params)).toEqual<IssueFilters>({});
  });
});

describe("applyIssueFilters", () => {
  const viewerLogin = "octocat";

  it("returns all issues with no filters", () => {
    const issues = [issueFixture({}), issueFixture({ id: "2" })];
    expect(applyIssueFilters(issues, {}, viewerLogin)).toHaveLength(2);
  });

  it("filters by search across title, description and identifier", () => {
    const issues = [
      issueFixture({ id: "1", title: "Add dark mode" }),
      issueFixture({ id: "2", description: "Improve DARK theme" }),
      issueFixture({ id: "3", identifier: "DARK-99" }),
      issueFixture({ id: "4", title: "Unrelated" }),
    ];

    const ids = applyIssueFilters(issues, { search: "dark" }, viewerLogin).map((issue) => issue.id);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("filters by assignee with 'me' substitution", () => {
    const issues = [
      issueFixture({ id: "1", assignee: "octocat" }),
      issueFixture({ id: "2", assignee: "alice" }),
    ];

    expect(applyIssueFilters(issues, { assignee: "me" }, viewerLogin).map((i) => i.id)).toEqual(["1"]);
  });

  it("filters by creator with literal login", () => {
    const issues = [
      issueFixture({ id: "1", creator: "octocat" }),
      issueFixture({ id: "2", creator: "alice" }),
    ];

    expect(applyIssueFilters(issues, { creator: "alice" }, viewerLogin).map((i) => i.id)).toEqual(["2"]);
  });
});
