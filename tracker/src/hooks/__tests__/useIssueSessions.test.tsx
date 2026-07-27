import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueSessions } from "@/hooks/useIssueSessions";
import { listAssistantThreads } from "@/services/assistantThreads";

vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: vi.fn(),
}));

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: vi.fn(),
}));

const listAssistantThreadsMock = vi.mocked(listAssistantThreads);

describe("useIssueSessions", () => {
  beforeEach(() => {
    listAssistantThreadsMock.mockReset();
  });

  it("loads persisted issue_execution threads when the live orchestrator snapshot is empty", async () => {
    listAssistantThreadsMock.mockResolvedValue([
      {
        id: 8082,
        scope: "issue_execution",
        agentKind: "codex",
        requestedModel: null,
        requestedEffort: null,
        resolvedModel: null,
        resolvedEffort: null,
        projectSlug: "gamba",
        projectName: "Gamba",
        issueIdentifier: "GAM-23",
        workspacePath: "/tmp/GAM-23",
        labels: [],
        needsReview: false,
        title: "Run · GAM-23 · SoftSwiss",
        status: "active",
        preview: null,
        updatedAt: "2026-07-26T14:08:40Z",
      },
      {
        id: 12,
        scope: "issue_session",
        agentKind: "codex",
        requestedModel: null,
        requestedEffort: null,
        resolvedModel: null,
        resolvedEffort: null,
        projectSlug: "gamba",
        projectName: "Gamba",
        issueIdentifier: "GAM-23",
        workspacePath: null,
        labels: [],
        needsReview: false,
        title: "Chat pass",
        status: "active",
        preview: null,
        updatedAt: "2026-07-26T13:00:00Z",
      },
    ]);

    const { result } = renderHook(() =>
      useIssueSessions("gamba", { identifier: "GAM-23", title: "SoftSwiss" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(listAssistantThreadsMock).toHaveBeenCalledWith({
      projectSlug: "gamba",
      issueIdentifier: "GAM-23",
      scopes: ["issue_session", "issue", "issue_execution"],
    });

    expect(result.current.executionSessions).toHaveLength(1);
    expect(result.current.executionSessions[0]?.execution.executionSessionId).toBe(8082);
    expect(result.current.executionSessions[0]?.title).toBe("Run · GAM-23 · SoftSwiss");
    expect(result.current.executionSession?.execution.executionSessionId).toBe(8082);
    expect(result.current.chatSessions.map((thread) => thread.id)).toEqual([12]);
  });

  it("prefers the live orchestrator execution status when it matches a persisted thread", async () => {
    listAssistantThreadsMock.mockResolvedValue([
      {
        id: 99,
        scope: "issue_execution",
        agentKind: "codex",
        requestedModel: null,
        requestedEffort: null,
        resolvedModel: null,
        resolvedEffort: null,
        projectSlug: "gamba",
        projectName: "Gamba",
        issueIdentifier: "GAM-23",
        workspacePath: "/tmp/GAM-23",
        labels: [],
        needsReview: false,
        title: "Run · GAM-23",
        status: "active",
        preview: null,
        updatedAt: "2026-07-26T14:08:40Z",
      },
    ]);

    const live = {
      issueIdentifier: "GAM-23",
      status: "live" as const,
      agentKind: "codex" as const,
      sessionId: "99",
      executionSessionId: 99,
      lastEvent: "agent_message",
      lastMessage: "working",
      lastEventAt: "2026-07-26T15:00:00Z",
      turnCount: 4,
      runtimeSeconds: 90,
      startedAt: "2026-07-26T14:08:40Z",
      retryAttempt: 0,
      error: null,
      goal: null,
      longRunning: false,
      longRunningKind: null,
      longRunningLabel: null,
      tokens: null,
    };

    const { result } = renderHook(() =>
      useIssueSessions("gamba", { identifier: "GAM-23", title: "SoftSwiss" }, live),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.executionSessions).toHaveLength(1);
    expect(result.current.executionSessions[0]?.status).toBe("live");
    expect(result.current.executionSessions[0]?.turnCount).toBe(4);
  });
});
