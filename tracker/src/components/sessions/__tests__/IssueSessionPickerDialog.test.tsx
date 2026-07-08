import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueSessionPickerDialog } from "@/components/sessions/IssueSessionPickerDialog";
import type { Issue } from "@/types/issue";

const listIssuesMock = vi.hoisted(() => vi.fn());
const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", () => ({
  listIssues: (...args: unknown[]) => listIssuesMock(...args),
}));

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

const sampleIssues: Issue[] = [
  {
    id: "1",
    identifier: "MAC-510",
    projectSlug: "macro-markets",
    status: "In Progress",
    title: "Add languages resource",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-05-31T00:00:00Z",
    updatedAt: "2026-05-31T00:00:00Z",
    attachments: [],
  },
];

describe("IssueSessionPickerDialog", () => {
  beforeEach(() => {
    listIssuesMock.mockReset();
    dispatchIssueAgentMock.mockReset();
    listIssuesMock.mockResolvedValue(sampleIssues);
    dispatchIssueAgentMock.mockResolvedValue({
      action: "hard_reset",
      message: "New session started",
      issue: sampleIssues[0],
    });
  });

  it("opens the configure dialog and starts a build-mode session", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <IssueSessionPickerDialog
                projectSlug="macro-markets"
                open
                onOpenChange={() => {}}
              />
            }
          />
          <Route
            path="/projects/macro-markets/sessions"
            element={<div>Sessions workspace</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledWith("macro-markets", { search: undefined }));

    await user.click(await screen.findByRole("option", { name: /MAC-510/i }));
    await user.click(await screen.findByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith("macro-markets", "MAC-510", {
        action: "hard_reset",
        mode: "build",
        agent: "codex",
        instructions: null,
      }),
    );
    expect(await screen.findByText("Sessions workspace")).toBeInTheDocument();
  });
});
