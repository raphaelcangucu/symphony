import type { NavigateFunction } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { startNewIssueExecutionSession } from "@/lib/startNewIssueExecutionSession";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("startNewIssueExecutionSession", () => {
  beforeEach(() => {
    dispatchIssueAgentMock.mockReset();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "hard_reset",
      message: "Started",
      issue: { identifier: "MAC-510" },
    });
  });

  it("dispatches hard_reset in build mode and optionally navigates to the sessions workspace", async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;

    await startNewIssueExecutionSession("macro-markets", "MAC-510", { navigate, mode: "build", agent: "codex" });

    expect(dispatchIssueAgentMock).toHaveBeenCalledWith("macro-markets", "MAC-510", {
      action: "hard_reset",
      mode: "build",
      agent: "codex",
      instructions: null,
    });
    expect(navigate).toHaveBeenCalledWith("/projects/macro-markets/sessions?exec=MAC-510&agent=execution");
  });

  it("can stay on the current page when navigateToSessions is false", async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;

    await startNewIssueExecutionSession("macro-markets", "MAC-510", {
      navigate,
      navigateToSessions: false,
    });

    expect(navigate).not.toHaveBeenCalled();
  });
});
