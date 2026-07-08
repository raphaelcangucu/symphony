import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueSessionPickerDialog } from "@/components/sessions/IssueSessionPickerDialog";
import type { Issue } from "@/types/issue";

const listIssuesMock = vi.hoisted(() => vi.fn());
const createIssueSessionThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", () => ({
  listIssues: (...args: unknown[]) => listIssuesMock(...args),
}));

vi.mock("@/services/assistantThreads", () => ({
  createIssueSessionThread: (...args: unknown[]) => createIssueSessionThreadMock(...args),
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
    createIssueSessionThreadMock.mockReset();
    listIssuesMock.mockResolvedValue(sampleIssues);
    createIssueSessionThreadMock.mockResolvedValue({
      id: 42,
      scope: "issue_session",
      agentKind: "codex",
      projectSlug: "macro-markets",
      projectName: "Macro Markets",
      issueIdentifier: "MAC-510",
      title: "Issue session",
      status: "active",
      preview: null,
      updatedAt: "2026-07-01T00:00:00Z",
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
            path="/projects/macro-markets/workspaces/:threadId"
            element={<div>Sessions workspace</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledWith("macro-markets", { search: undefined }));

    await user.click(await screen.findByRole("option", { name: /MAC-510/i }));
    await user.click(await screen.findByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith("macro-markets", "MAC-510", {
        title: "Issue session",
        agentKind: "codex",
        executionMode: "build",
        isolatedWorkspace: false,
      }),
    );
    expect(await screen.findByText("Sessions workspace")).toBeInTheDocument();
  });
});
