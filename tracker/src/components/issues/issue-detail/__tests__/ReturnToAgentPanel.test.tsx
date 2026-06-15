import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import type { Issue } from "@/types/issue";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

const issue = {
  id: "1",
  identifier: "CDE-1132",
  title: "Evidence gap",
  status: "Revisão de pares",
  priority: 0,
  assignee: null,
  projectSlug: "advising",
  blockedBy: [],
  labels: [],
} as unknown as Issue;

describe("ReturnToAgentPanel", () => {
  beforeEach(() => {
    dispatchIssueAgentMock.mockReset();
  });

  it("continues work with template instructions and target status", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "continue_work",
      message: "Continuing agent work on CDE-1132",
      issue: { ...issue, status: "Em andamento" },
    });

    const user = userEvent.setup();
    render(
      <ReturnToAgentPanel
        projectSlug="advising"
        issue={issue}
        trackerConfig={{
          activeStates: ["Selected for Development", "Em andamento"],
          dispatchStates: ["Selected for Development"],
          waitStates: ["Revisão de pares"],
          terminalStates: ["Concluído"],
          reworkTarget: "Em andamento",
        }}
        evidenceAttention={{ kind: "missing", latestRecord: null, failedRuns: [] }}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    expect(screen.getByText(/Evidence: ausente/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /voltar para em andamento e retomar/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "continue_work",
          targetStatus: "Em andamento",
          instructions: expect.stringContaining("VALIDATE"),
        }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalled();
  });
});
