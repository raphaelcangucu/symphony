import { describe, expect, it } from "vitest";
import {
  issueWorkspaceScope,
  threadWorkspaceScope,
  workspaceScopeKey,
  workspaceScopesEqual,
} from "@/lib/workspaceScope";

describe("workspaceScope", () => {
  it("builds issue and thread scopes", () => {
    expect(issueWorkspaceScope("macro-markets", "510", 99)).toEqual({
      kind: "issue",
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      threadId: 99,
    });
    expect(threadWorkspaceScope("macro-markets", 8076, "/ws/flaky-pipe")).toEqual({
      kind: "thread",
      projectSlug: "macro-markets",
      threadId: 8076,
      workspacePath: "/ws/flaky-pipe",
    });
  });

  it("compares scopes by identity fields", () => {
    const a = threadWorkspaceScope("p", 1, "/a");
    const b = threadWorkspaceScope("p", 1, "/b");
    expect(workspaceScopesEqual(a, b)).toBe(true);
    expect(workspaceScopesEqual(a, issueWorkspaceScope("p", "1"))).toBe(false);
  });

  it("stable keys for dock state", () => {
    expect(workspaceScopeKey(issueWorkspaceScope("p", "510"))).toBe("issue:p:510");
    expect(workspaceScopeKey(threadWorkspaceScope("p", 8076, null))).toBe("thread:p:8076");
  });
});
