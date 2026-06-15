import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
}));

const issue = {
  id: "1",
  identifier: "CDE-1132",
  title: "Custom fields",
  status: "Em andamento",
  priority: 0,
  assignee: null,
  projectSlug: "advising",
  blockedBy: [],
  labels: [],
  agentKind: "codex",
} as unknown as Issue;

describe("ExecutionControlComposer", () => {
  beforeEach(() => {
    dispatchIssueAgentMock.mockReset();
    fetchAssistantCatalogBundleMock.mockResolvedValue({
      agents: [
        {
          agent: "codex",
          agentLabel: "Codex",
          command: "codex",
          models: [{ id: "gpt-5", model: "gpt-5", label: "GPT-5" }],
          efforts: [{ id: "high", label: "High" }],
        },
      ],
    });
  });

  it("steers a live run with /infer", () => {
    const onSteer = vi.fn();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        sessionConnected
        canSteer
        onSteer={onSteer}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/focus on the failing test/i), {
      target: { value: "/infer prefer the simpler fix" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^steer$/i }));

    expect(onSteer).toHaveBeenCalledWith("prefer the simpler fix");
  });

  it("resumes a stalled run", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "resume",
      message: "Resuming agent work on CDE-1132",
      issue,
    });

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        sessionConnected
        onSteer={vi.fn()}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /^resume$/i })[0]!);

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          goal: null,
          instructions: null,
        }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalledWith(issue);
  });

  it("enables resume when the run was interrupted but reported as idle", async () => {
    const interrupted = {
      issueIdentifier: "CDE-1132",
      status: "idle",
      agentKind: "codex",
      sessionId: "sess-1",
      lastEvent: "turn_aborted",
      lastMessage: "Agent run interrupted — resume from the session log",
      lastEventAt: null,
      turnCount: 0,
      runtimeSeconds: null,
      startedAt: null,
      retryAttempt: 0,
      error: "Agent run interrupted — use Resume in the execution panel",
      goal: null,
      longRunning: false,
      longRunningKind: null,
      longRunningLabel: null,
      tokens: null,
    } satisfies AgentExecution;

    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={interrupted}
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^resume$/i })[0]).not.toBeDisabled();
  });

  it("hard resets the session after confirmation", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "hard_reset",
      message: "Hard reset session for CDE-1132",
      issue,
    });

    const active = {
      issueIdentifier: "CDE-1132",
      status: "live",
      agentKind: "codex",
      sessionId: "sess-1",
      lastEvent: "turn_completed",
      lastMessage: "turn completed (failed)",
      lastEventAt: null,
      turnCount: 4,
      runtimeSeconds: null,
      startedAt: null,
      retryAttempt: 0,
      error: null,
      goal: null,
      longRunning: false,
      longRunningKind: null,
      longRunningLabel: null,
      tokens: null,
    } satisfies AgentExecution;

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={active}
        onSteer={vi.fn()}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    const hardResetTrigger = screen.getByRole("button", { name: /hard reset/i });
    expect(hardResetTrigger).not.toBeDisabled();

    await user.click(hardResetTrigger);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^hard reset$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ action: "hard_reset" }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalledWith(issue);
  });

  it("shows a friendly steer error when no turn is steerable", () => {
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        sessionConnected
        steerError="ActiveTurnNotSteerable"
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getByText(/use resume to pick the run back up/i)).toBeInTheDocument();
  });
});
