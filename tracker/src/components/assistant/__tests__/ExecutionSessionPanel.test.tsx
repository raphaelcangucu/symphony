import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionSessionPanel } from "@/components/assistant/ExecutionSessionPanel";
import { initTestI18n } from "@/i18n/testUtils";
import type { Issue } from "@/types/issue";

const steerTurnMock = vi.hoisted(() => vi.fn());
const useExecutionSessionModeMock = vi.hoisted(() => vi.fn());
const getIssueMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/assistant/useExecutionSessionMode", () => ({
  useExecutionSessionMode: (...args: unknown[]) => useExecutionSessionModeMock(...args),
}));

vi.mock("@/services/issues", () => ({
  getIssue: (...args: unknown[]) => getIssueMock(...args),
}));

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: vi.fn(),
}));

vi.mock("@/components/issues/issue-detail/ExecutionControlComposer", () => ({
  ExecutionControlComposer: ({
    canSteer,
    onSteer,
  }: {
    canSteer?: boolean;
    onSteer: (payload: { message: string; attachments: unknown[] }) => void;
  }) => (
    <div data-testid="execution-composer" data-can-steer={canSteer ? "true" : "false"}>
      <button type="button" onClick={() => onSteer({ message: "steer me", attachments: [] })}>
        Steer
      </button>
    </div>
  ),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: () => null,
}));

function sampleIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "510",
    projectSlug: "macro-markets",
    status: "in_progress",
    title: "Run",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
    attachments: [],
    agentKind: "codex",
    ...overrides,
  };
}

describe("ExecutionSessionPanel", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    getIssueMock.mockReset();
    steerTurnMock.mockReset();
    useExecutionSessionModeMock.mockReset();
    getIssueMock.mockResolvedValue(sampleIssue());
    useExecutionSessionModeMock.mockReturnValue({
      entries: [],
      feedItems: [
        {
          type: "message",
          id: "m1",
          message: {
            id: "m1",
            role: "assistant",
            content: "From session log",
            toolCalls: [],
            metadata: { source: "session_log" },
          },
        },
      ],
      taskSnapshot: null,
      execution: { issueIdentifier: "510", status: "live", agentKind: "codex", executionSessionId: 9001 },
      executions: [],
      connected: true,
      error: null,
      canSteer: true,
      isActive: true,
      steerTurn: steerTurnMock,
      steerPending: false,
      steerError: null,
      logAgentKind: "codex",
      preferredAgentKind: "codex",
    });
  });

  it("renders the adapted session-log body and execution composer (not interactive history)", async () => {
    render(
      <MemoryRouter>
        <ExecutionSessionPanel
          projectSlug="macro-markets"
          threadId={9001}
          issueIdentifier="510"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("execution-session-panel")).toHaveAttribute(
      "data-execution-mode",
      "true",
    );
    expect(await screen.findByText("From session log")).toBeInTheDocument();
    expect(await screen.findByTestId("execution-composer")).toHaveAttribute("data-can-steer", "true");
    expect(screen.queryByTestId("assistant-panel")).toBeNull();

    await waitFor(() => {
      expect(useExecutionSessionModeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectSlug: "macro-markets",
          threadId: 9001,
          issueIdentifier: "510",
          enabled: true,
        }),
      );
    });
  });

  it("renders the execution composer when issue hydration fails", async () => {
    getIssueMock.mockRejectedValue(new Error("Remote error"));

    render(
      <MemoryRouter>
        <ExecutionSessionPanel
          projectSlug="macro-markets"
          threadId={9001}
          issueIdentifier="510"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("execution-composer")).toBeInTheDocument();
  });
});
