import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";

const createIssueSessionThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createIssueSessionThread: (...args: unknown[]) => createIssueSessionThreadMock(...args),
}));

describe("StartIssueSessionDialog", () => {
  beforeEach(() => {
    createIssueSessionThreadMock.mockReset();
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
      updatedAt: "2026-07-04T00:00:00.000Z",
    });
  });

  it("creates a build-mode issue session thread", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{ identifier: "MAC-510", title: "Add languages", agentKind: "codex" }}
                open
                onOpenChange={() => {}}
                onCreated={onCreated}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("execution-mode-icon-yolo")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/session title/i), "Build pass 2");
    await user.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith("macro-markets", "MAC-510", {
        title: "Build pass 2",
        agentKind: "codex",
        executionMode: "yolo",
        isolatedWorkspace: false,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it("keeps typed title and agent when parent re-renders with a new issue object", async () => {
    const user = userEvent.setup();
    const baseIssue = { identifier: "MAC-510", title: "Add languages", agentKind: "codex" as const };

    const { rerender } = render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={baseIssue}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/session title/i), "Build pass 2");
    await user.click(screen.getByRole("button", { name: /claude code/i }));

    rerender(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{ ...baseIssue }}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/session title/i)).toHaveValue("Build pass 2");
    expect(screen.getByRole("button", { name: /claude code/i })).toHaveAttribute("aria-pressed", "true");
  });
});
