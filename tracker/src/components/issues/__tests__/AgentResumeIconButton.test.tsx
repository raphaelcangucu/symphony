import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { AgentResumeIconButton, shouldShowResumeIcon } from "@/components/issues/AgentResumeIconButton";
import type { AgentExecution } from "@/types/agent-execution";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "BACK-301",
    agentKind: "codex",
    status: "idle",
    sessionId: "sess-1",
    turnCount: 1,
    runtimeSeconds: 42,
    startedAt: null,
    lastActivityAt: null,
    lastEvent: null,
    lastMessage: null,
    error: null,
    longRunning: false,
    longRunningLabel: null,
    goal: null,
    ...overrides,
  };
}

describe("shouldShowResumeIcon", () => {
  it("returns true for aborted runs that can resume", () => {
    expect(
      shouldShowResumeIcon(
        execution({ status: "idle", lastEvent: "turn_aborted", error: "interrupted" }),
      ),
    ).toBe(true);
  });

  it("returns false for active runs", () => {
    expect(shouldShowResumeIcon(execution({ status: "live" }))).toBe(false);
  });

  it("returns false for idle runs without abort signals", () => {
    expect(shouldShowResumeIcon(execution({ status: "idle" }))).toBe(false);
  });
});

describe("AgentResumeIconButton", () => {
  it("dispatches resume and stops click propagation", async () => {
    dispatchIssueAgentMock.mockReset();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "resume",
      message: "Retomando agente…",
      issue: { identifier: "BACK-301" },
    });

    const parentClick = vi.fn();
    const aborted = execution({
      status: "idle",
      lastEvent: "turn_aborted",
      error: "Agent run interrupted",
    });

    render(
      <div onClick={parentClick}>
        <AgentResumeIconButton
          projectSlug="macro-markets"
          issueIdentifier="BACK-301"
          execution={aborted}
        />
      </div>,
    );

    const button = screen.getByRole("button", { name: /^resume$/i });
    fireEvent.click(button);

    expect(parentClick).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith("macro-markets", "BACK-301", { action: "resume" }),
    );
  });

  it("does not render when the run is active", () => {
    render(
      <AgentResumeIconButton
        projectSlug="macro-markets"
        issueIdentifier="BACK-301"
        execution={execution({ status: "live" })}
      />,
    );

    expect(screen.queryByRole("button", { name: /^resume$/i })).not.toBeInTheDocument();
  });
});
