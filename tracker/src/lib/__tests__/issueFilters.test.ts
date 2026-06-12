import { describe, expect, it } from "vitest";

import {
  applyIssueFilters,
  ASSIGNEE_PARAM,
  countActiveFilters,
  filtersFromSearchParams,
  setListParam,
  toggleListParam,
  UNASSIGNED_TOKEN,
  type IssueFilters,
} from "@/lib/issueFilters";
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
    url: null,
    branchName: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("filtersFromSearchParams", () => {
  it("parses search, multi assignee/creator and recent days", () => {
    const params = new URLSearchParams({ q: " login ", assignee: "me, alice ,me", creator: "octocat", updated: "7d" });

    expect(filtersFromSearchParams(params)).toEqual<IssueFilters>({
      search: "login",
      assignees: ["me", "alice"],
      creators: ["octocat"],
      recentDays: 7,
    });
  });

  it("returns empty arrays when nothing is set", () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual<IssueFilters>({ assignees: [], creators: [] });
  });
});

describe("applyIssueFilters", () => {
  it("returns all issues with no filters", () => {
    const issues = [issueFixture({}), issueFixture({ id: "2" })];
    expect(applyIssueFilters(issues, { assignees: [], creators: [] })).toHaveLength(2);
  });

  it("matches any of several assignees", () => {
    const issues = [
      issueFixture({ id: "1", assignee: "alice" }),
      issueFixture({ id: "2", assignee: "bob" }),
      issueFixture({ id: "3", assignee: "carol" }),
    ];

    const ids = applyIssueFilters(issues, { assignees: ["alice", "carol"], creators: [] }).map((i) => i.id);
    expect(ids).toEqual(["1", "3"]);
  });

  it("resolves 'me' against identity values, case-insensitively", () => {
    const issues = [
      issueFixture({ id: "1", assignee: "Ignacio Salvarrey" }),
      issueFixture({ id: "2", assignee: "alice" }),
    ];

    const ids = applyIssueFilters(issues, { assignees: ["me"], creators: [] }, ["ignacio salvarrey"]).map((i) => i.id);
    expect(ids).toEqual(["1"]);
  });

  it("matches unassigned issues via the @none token", () => {
    const issues = [issueFixture({ id: "1", assignee: null }), issueFixture({ id: "2", assignee: "alice" })];

    const ids = applyIssueFilters(issues, { assignees: [UNASSIGNED_TOKEN], creators: [] }).map((i) => i.id);
    expect(ids).toEqual(["1"]);
  });

  it("combines unassigned with named assignees", () => {
    const issues = [
      issueFixture({ id: "1", assignee: null }),
      issueFixture({ id: "2", assignee: "alice" }),
      issueFixture({ id: "3", assignee: "bob" }),
    ];

    const ids = applyIssueFilters(issues, { assignees: [UNASSIGNED_TOKEN, "alice"], creators: [] }).map((i) => i.id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("filters issues updated within the recent window", () => {
    const recent = new Date().toISOString();
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const issues = [
      issueFixture({ id: "1", updatedAt: recent }),
      issueFixture({ id: "2", updatedAt: stale }),
    ];

    const ids = applyIssueFilters(issues, { assignees: [], creators: [], recentDays: 7 }).map((i) => i.id);
    expect(ids).toEqual(["1"]);
  });

  it("filters by search across title, description and identifier", () => {
    const issues = [
      issueFixture({ id: "1", title: "Add dark mode" }),
      issueFixture({ id: "2", description: "Improve DARK theme" }),
      issueFixture({ id: "3", identifier: "DARK-99" }),
      issueFixture({ id: "4", title: "Unrelated" }),
    ];

    const ids = applyIssueFilters(issues, { search: "dark", assignees: [], creators: [] }).map((i) => i.id);
    expect(ids).toEqual(["1", "2", "3"]);
  });
});

describe("toggleListParam / setListParam", () => {
  it("adds and removes a value from a comma list", () => {
    const base = new URLSearchParams();
    const added = toggleListParam(base, ASSIGNEE_PARAM, "alice");
    expect(added.get(ASSIGNEE_PARAM)).toBe("alice");

    const both = toggleListParam(added, ASSIGNEE_PARAM, "bob");
    expect(both.get(ASSIGNEE_PARAM)).toBe("alice,bob");

    const removed = toggleListParam(both, ASSIGNEE_PARAM, "alice");
    expect(removed.get(ASSIGNEE_PARAM)).toBe("bob");

    const cleared = toggleListParam(removed, ASSIGNEE_PARAM, "bob");
    expect(cleared.has(ASSIGNEE_PARAM)).toBe(false);
  });

  it("replaces the whole list with setListParam", () => {
    const set = setListParam(new URLSearchParams({ assignee: "x" }), ASSIGNEE_PARAM, ["a", "b"]);
    expect(set.get(ASSIGNEE_PARAM)).toBe("a,b");
    expect(setListParam(set, ASSIGNEE_PARAM, []).has(ASSIGNEE_PARAM)).toBe(false);
  });
});

describe("countActiveFilters", () => {
  it("sums search, every selected person and the recent toggle", () => {
    expect(
      countActiveFilters({ search: "x", assignees: ["a", "b"], creators: ["c"], recentDays: 7 }),
    ).toBe(5);
    expect(countActiveFilters({ assignees: [], creators: [] })).toBe(0);
  });
});
