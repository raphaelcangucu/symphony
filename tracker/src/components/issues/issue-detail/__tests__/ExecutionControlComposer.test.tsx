import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
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
