import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoalControls } from "@/components/issues/issue-detail/GoalControls";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";
import type { AgentExecutionGoal } from "@/types/agent-execution";

const controlIssueGoalMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/goalControl", () => ({
  controlIssueGoal: (...args: unknown[]) => controlIssueGoalMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

function goal(overrides: Partial<AgentExecutionGoal> = {}): AgentExecutionGoal {
  return {
    kind: "goal",
    source: "native",
    objective: "Ship the goal mode",
    status: "active",
    capabilities: ["pause", "resume", "clear"],
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    updatedAt: null,
    ...overrides,
  };
}

function renderControls(value: AgentExecutionGoal, onChanged = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <GoalControls projectSlug="advising" issueIdentifier="CDE-1" goal={value} onChanged={onChanged} />
    </I18nextProvider>,
  );
}

describe("GoalControls", () => {
  beforeEach(async () => {
    controlIssueGoalMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    await initTestI18n("en");
  });

  it("renders nothing for prompt-injected (non-native) goals", () => {
    const { container } = renderControls(goal({ source: "prompt", kind: "workflow" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows pause/clear but not resume when the goal is active", () => {
    renderControls(goal({ status: "active" }));
    expect(screen.getByRole("button", { name: /pause goal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear goal/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume goal/i })).not.toBeInTheDocument();
  });

  it("shows resume but not pause when the goal is paused", () => {
    renderControls(goal({ status: "paused" }));
    expect(screen.getByRole("button", { name: /resume goal/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause goal/i })).not.toBeInTheDocument();
  });

  it("respects missing capabilities", () => {
    const { container } = renderControls(goal({ status: "active", capabilities: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("calls the control service and reports the updated goal on pause", async () => {
    const updated = goal({ status: "paused" });
    controlIssueGoalMock.mockResolvedValue({ action: "pause", cleared: false, goal: updated });
    const onChanged = vi.fn();
    const user = userEvent.setup();

    renderControls(goal({ status: "active" }), onChanged);
    await user.click(screen.getByRole("button", { name: /pause goal/i }));

    await waitFor(() => {
      expect(controlIssueGoalMock).toHaveBeenCalledWith("advising", "CDE-1", { action: "pause" });
    });
    expect(onChanged).toHaveBeenCalledWith(updated);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it("reports a null goal when cleared", async () => {
    controlIssueGoalMock.mockResolvedValue({ action: "clear", cleared: true, goal: null });
    const onChanged = vi.fn();
    const user = userEvent.setup();

    renderControls(goal({ status: "active" }), onChanged);
    await user.click(screen.getByRole("button", { name: /clear goal/i }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(null);
    });
  });

  it("surfaces an error toast when the control fails", async () => {
    controlIssueGoalMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();

    renderControls(goal({ status: "active" }));
    await user.click(screen.getByRole("button", { name: /pause goal/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("boom");
    });
  });
});
