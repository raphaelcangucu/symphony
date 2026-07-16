import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { fallbackCatalogBundle } from "@/lib/assistantSettings";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";

const createIssueSessionThreadMock = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createIssueSessionThread: (...args: unknown[]) => createIssueSessionThreadMock(...args),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
}));

const catalogBundle = (() => {
  const bundle = fallbackCatalogBundle();
  bundle.agents = [
    { ...mockAssistantCodexCatalog },
    ...bundle.agents.filter((agent) => agent.agent !== "codex"),
  ];
  return bundle;
})();

describe("StartIssueSessionDialog", () => {
  beforeEach(() => {
    createIssueSessionThreadMock.mockReset();
    fetchAssistantCatalogBundleMock.mockReset();
    fetchAssistantCatalogBundleMock.mockResolvedValue(catalogBundle);
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
      workspacePath: null,
      labels: [],
      needsReview: false,
    });
  });

  it("prefills the session title with the issue title", () => {
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
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/session title/i)).toHaveValue("Add languages");
  });

  it("creates a build-mode issue session thread on the issue tree by default", async () => {
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

    expect(screen.getByTestId("execution-mode-icon-build")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-target-issue")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-target-parent")).not.toBeInTheDocument();

    const titleInput = screen.getByLabelText(/session title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Build pass 2");
    await user.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith(
        "macro-markets",
        "MAC-510",
        expect.objectContaining({
          title: "Build pass 2",
          agentKind: "codex",
          executionMode: "build",
          isolatedWorkspace: false,
          useParentWorkspace: false,
          model: expect.any(String),
          effort: expect.any(String),
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it("offers the parent tree option for subtasks and sends useParentWorkspace", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{
                  identifier: "MAC-16",
                  title: "Settlement",
                  agentKind: "codex",
                  parentIdentifier: "510",
                }}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workspace-target-parent")).toBeInTheDocument();
    await user.click(screen.getByTestId("workspace-target-parent"));
    await user.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith(
        "macro-markets",
        "MAC-16",
        expect.objectContaining({
          isolatedWorkspace: false,
          useParentWorkspace: true,
        }),
      ),
    );
  });

  it("sends isolatedWorkspace when the parallel tree option is selected", async () => {
    const user = userEvent.setup();

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
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId("workspace-target-isolated"));
    await user.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith(
        "macro-markets",
        "MAC-510",
        expect.objectContaining({
          isolatedWorkspace: true,
          useParentWorkspace: false,
        }),
      ),
    );
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

    const titleInput = screen.getByLabelText(/session title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Build pass 2");
    await user.click(await screen.findByRole("button", { name: /codex/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /claude/i }));

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
    expect(screen.getByRole("button", { name: /^claude code$/i })).toBeInTheDocument();
  });
});
