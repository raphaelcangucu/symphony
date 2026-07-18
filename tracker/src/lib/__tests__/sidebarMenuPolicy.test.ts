import { describe, expect, it } from "vitest";
import {
  sidebarRemoveIssueRequest,
  sidebarRenameRequest,
} from "@/lib/sidebarMenuPolicy";
import type { SidebarCapabilityContext, SidebarSessionNode } from "@/types/sidebar";

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:7",
    projectSlug: "demo",
    workspaceId: null,
    sessionKind: "chat",
    title: "Chat · GAM-20 · Fix login",
    subtitle: "GAM-20",
    href: "/projects/demo/workspaces?session=7",
    statusKind: "idle",
    aggregateStatus: "idle",
    agentKind: "codex",
    updatedAt: "2026-07-17T00:00:00Z",
    threadId: 7,
    issueIdentifier: "GAM-20",
    archived: false,
    unread: false,
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: false,
    ...overrides,
  };
}

const context = {} as SidebarCapabilityContext;

describe("sidebarRenameRequest", () => {
  it("renames issue-backed sessions via rename-thread when threadId exists", () => {
    expect(sidebarRenameRequest(session(), context, "My name")).toEqual({
      action: "rename-thread",
      projectSlug: "demo",
      threadId: 7,
      title: "My name",
    });
  });

  it("returns null for issue-backed session rows without threadId", () => {
    expect(sidebarRenameRequest(session({ threadId: null }), context, "My name")).toBeNull();
  });
});

describe("sidebarRemoveIssueRequest", () => {
  it("maps inactive execution sessions to delete-issue", () => {
    expect(
      sidebarRemoveIssueRequest(
        session({
          sessionKind: "execution",
          issueIdentifier: "GAM-20",
          aggregateStatus: "idle",
        }),
      ),
    ).toEqual({
      action: "delete-issue",
      projectSlug: "demo",
      identifier: "GAM-20",
      active: false,
    });
  });

  it("marks active executions so the dispatcher can reject them", () => {
    expect(
      sidebarRemoveIssueRequest(
        session({
          sessionKind: "execution",
          issueIdentifier: "GAM-20",
          aggregateStatus: "active",
        }),
      ),
    ).toMatchObject({ action: "delete-issue", active: true });
  });

  it("returns null for non-execution sessions", () => {
    expect(sidebarRemoveIssueRequest(session())).toBeNull();
  });
});
