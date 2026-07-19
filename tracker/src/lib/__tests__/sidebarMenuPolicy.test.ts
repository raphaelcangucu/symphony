import { describe, expect, it } from "vitest";
import {
  sidebarArchiveRequest,
  sidebarRemoveExecutionRequest,
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

describe("sidebarArchiveRequest for executions", () => {
  it("archives the execution thread when threadId is present", () => {
    expect(
      sidebarArchiveRequest(
        session({
          sessionKind: "execution",
          threadId: 42,
          issueIdentifier: "GAM-20",
        }),
        context,
      ),
    ).toEqual({
      action: "archive-thread",
      projectSlug: "demo",
      threadId: 42,
      canArchive: true,
    });
  });
});

describe("sidebarRemoveExecutionRequest", () => {
  it("maps thread-backed executions to delete-thread", () => {
    expect(
      sidebarRemoveExecutionRequest(
        session({
          sessionKind: "execution",
          threadId: 42,
          issueIdentifier: "GAM-20",
          aggregateStatus: "active",
          archived: false,
        }),
      ),
    ).toEqual({
      action: "delete-thread",
      projectSlug: "demo",
      threadId: 42,
      sessionKind: "execution",
      local: true,
      archived: false,
      closed: false,
    });
  });

  it("falls back to delete-issue when an execution has no thread id", () => {
    expect(
      sidebarRemoveExecutionRequest(
        session({
          sessionKind: "execution",
          threadId: null,
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

  it("returns null for non-execution sessions", () => {
    expect(sidebarRemoveExecutionRequest(session())).toBeNull();
  });
});
