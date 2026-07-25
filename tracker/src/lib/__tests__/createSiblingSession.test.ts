import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSiblingSession } from "@/lib/createSiblingSession";
import type { AssistantThread } from "@/types/assistant-thread";

const createProjectSessionThread = vi.hoisted(() => vi.fn());
const createIssueSessionThread = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createProjectSessionThread,
  createIssueSessionThread,
}));

function thread(overrides: Partial<AssistantThread> = {}): AssistantThread {
  return {
    id: 8006,
    scope: "project_session",
    agentKind: "cursor",
    requestedModel: null,
    requestedEffort: null,
    resolvedModel: null,
    resolvedEffort: null,
    projectSlug: "advising",
    projectName: "Advising",
    issueIdentifier: null,
    workspacePath: "/workspaces/advising/main",
    labels: [],
    needsReview: false,
    title: "Sessão do projeto",
    status: "active",
    preview: null,
    updatedAt: "2026-07-15T12:00:00Z",
    ...overrides,
  };
}

describe("createSiblingSession", () => {
  beforeEach(() => {
    createProjectSessionThread.mockReset();
    createIssueSessionThread.mockReset();
    createProjectSessionThread.mockResolvedValue(
      thread({ id: 9001, title: null }),
    );
    createIssueSessionThread.mockResolvedValue(
      thread({
        id: 9002,
        scope: "issue_session",
        issueIdentifier: "ADV-1",
        title: null,
      }),
    );
  });

  it("creates a project session mirroring workspacePath and agentKind without copying title", async () => {
    const created = await createSiblingSession(thread());

    expect(createProjectSessionThread).toHaveBeenCalledWith("advising", {
      workspacePath: "/workspaces/advising/main",
      agentKind: "cursor",
    });
    expect(createIssueSessionThread).not.toHaveBeenCalled();
    expect(created.id).toBe(9001);
  });

  it("creates an issue session when issueIdentifier is present", async () => {
    await createSiblingSession(
      thread({
        scope: "issue_session",
        issueIdentifier: "ADV-42",
        workspacePath: "/workspaces/advising/ADV-42",
        agentKind: "codex",
      }),
    );

    expect(createIssueSessionThread).toHaveBeenCalledWith(
      "advising",
      "ADV-42",
      {
        workspacePath: "/workspaces/advising/ADV-42",
        agentKind: "codex",
      },
    );
    expect(createProjectSessionThread).not.toHaveBeenCalled();
  });

  it("routes by issueIdentifier even when scope is project_session", async () => {
    await createSiblingSession(
      thread({
        scope: "project_session",
        issueIdentifier: "  ADV-7  ",
        workspacePath: "/workspaces/advising/ADV-7",
      }),
    );

    expect(createIssueSessionThread).toHaveBeenCalledWith("advising", "ADV-7", {
      workspacePath: "/workspaces/advising/ADV-7",
      agentKind: "cursor",
    });
  });

  it("omits workspacePath and agentKind when absent", async () => {
    await createSiblingSession(
      thread({
        workspacePath: null,
        agentKind: null,
      }),
    );

    expect(createProjectSessionThread).toHaveBeenCalledWith("advising", {});
  });

  it("fails fast when projectSlug is blank", async () => {
    await expect(
      createSiblingSession(thread({ projectSlug: "  " })),
    ).rejects.toThrow(/projectSlug/i);
    expect(createProjectSessionThread).not.toHaveBeenCalled();
  });

  it("treats whitespace-only issueIdentifier as project session", async () => {
    await createSiblingSession(thread({ issueIdentifier: "   " }));

    expect(createProjectSessionThread).toHaveBeenCalledWith("advising", {
      workspacePath: "/workspaces/advising/main",
      agentKind: "cursor",
    });
    expect(createIssueSessionThread).not.toHaveBeenCalled();
  });
});
