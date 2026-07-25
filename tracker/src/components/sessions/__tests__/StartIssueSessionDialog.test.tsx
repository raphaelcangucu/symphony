import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { createMockAssistantCatalogBundle } from "@/test-fixtures/assistantCatalog";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";
import type { WorkspaceCloneRepoOption } from "@/lib/workspaceCloneRepos";
import type { PullRequest } from "@/types/pull-request";
import type { WorkspaceInventory } from "@/types/worktrees";

const createIssueSessionThreadMock = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());
const fetchWorkspaceInventoryMock = vi.hoisted(() => vi.fn());
const listPullRequestsMock = vi.hoisted(() => vi.fn());
const getProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createIssueSessionThread: (...args: unknown[]) => createIssueSessionThreadMock(...args),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
}));

vi.mock("@/services/worktrees", () => ({
  fetchWorkspaceInventory: (...args: unknown[]) => fetchWorkspaceInventoryMock(...args),
}));

vi.mock("@/services/pullRequests", () => ({
  listPullRequests: (...args: unknown[]) => listPullRequestsMock(...args),
}));

vi.mock("@/services/projects", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
}));

const advisingCloneRepo: WorkspaceCloneRepoOption = {
  key: "advising",
  label: "advising",
  defaultBranch: "main",
  githubFullName: "civitaslearning/advising",
};

function emptyInventory(): WorkspaceInventory {
  return {
    entries: [],
    totals: { count: 0, sizeBytes: 0, reclaimableBytes: 0 },
  };
}

function issueInventory(branch: string): WorkspaceInventory {
  return {
    entries: [
      {
        path: "/tmp/CDE-1180",
        displayName: null,
        kind: "issue",
        issueIdentifier: "CDE-1180",
        name: null,
        classification: "active",
        reclaimable: false,
        workPresent: true,
        executionStatus: null,
        removable: true,
        sizeBytes: 1,
        repos: [
          {
            name: "advising",
            path: "/tmp/CDE-1180/advising",
            branch,
            defaultBranch: "main",
            dirty: false,
            upstream: true,
            aheadCount: 0,
            sizeBytes: 1,
          },
        ],
        childWorktrees: [],
      },
    ],
    totals: { count: 1, sizeBytes: 1, reclaimableBytes: 0 },
  };
}

function openPullRequest(headRef: string): PullRequest {
  return {
    number: 42,
    title: "PR",
    url: "https://github.com/civitaslearning/advising/pull/42",
    state: "open",
    repo: "civitaslearning/advising",
    origin: "auto",
    rawState: "OPEN",
    isDraft: false,
    merged: false,
    headRef,
    baseRef: "main",
    author: null,
    createdAt: null,
    updatedAt: "2026-07-16T12:00:00.000Z",
    mergedAt: null,
    mergeable: "MERGEABLE",
    checksState: null,
    pipelines: [],
    statuses: [],
    conversation: [],
    baseBehindBy: null,
    monitor: null,
  };
}

const catalogBundle = (() => {
  const bundle = createMockAssistantCatalogBundle();
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
    fetchWorkspaceInventoryMock.mockReset();
    listPullRequestsMock.mockReset();
    getProjectMock.mockReset();
    fetchAssistantCatalogBundleMock.mockResolvedValue(catalogBundle);
    fetchWorkspaceInventoryMock.mockResolvedValue(emptyInventory());
    listPullRequestsMock.mockResolvedValue({
      data: [],
      children: [],
      supported: true,
      available: true,
    });
    getProjectMock.mockResolvedValue({ repositories: [] });
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

  it("prefills the session title with Chat · identifier · issue title", () => {
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

    expect(screen.getByLabelText(/session title/i)).toHaveValue("Chat · MAC-510 · Add languages");
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
    const codexMenu = (await screen.findAllByRole("button", { name: /codex/i }))
      .find((button) => button.getAttribute("aria-haspopup") === "menu");
    expect(codexMenu).toBeDefined();
    await user.click(codexMenu as HTMLButtonElement);
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

  it("prefills branch fields from the issue working tree by default", async () => {
    fetchWorkspaceInventoryMock.mockResolvedValue(
      issueInventory("CDE-1180-advisor-groups-placeholder"),
    );
    listPullRequestsMock.mockResolvedValue({
      data: [openPullRequest("pr-should-not-win")],
      children: [],
      supported: true,
      available: true,
    });

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{
                  identifier: "CDE-1180",
                  title: "Adjust placeholder",
                  agentKind: "codex",
                }}
                cloneRepos={[advisingCloneRepo]}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/branch for advising/i)).toHaveValue(
        "CDE-1180-advisor-groups-placeholder",
      ),
    );
  });

  it("prefills branch fields from the open PR when isolated tree is selected", async () => {
    const user = userEvent.setup();
    fetchWorkspaceInventoryMock.mockResolvedValue(
      issueInventory("working-tree-branch"),
    );
    listPullRequestsMock.mockResolvedValue({
      data: [openPullRequest("CDE-1180-pr-head")],
      children: [],
      supported: true,
      available: true,
    });

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{
                  identifier: "CDE-1180",
                  title: "Adjust placeholder",
                  agentKind: "codex",
                }}
                cloneRepos={[advisingCloneRepo]}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/branch for advising/i)).toHaveValue("working-tree-branch"),
    );

    await user.click(screen.getByTestId("workspace-target-isolated"));

    await waitFor(() =>
      expect(screen.getByLabelText(/branch for advising/i)).toHaveValue("CDE-1180-pr-head"),
    );
  });

  it("keeps a manually edited branch when the workspace target changes", async () => {
    const user = userEvent.setup();
    fetchWorkspaceInventoryMock.mockResolvedValue(
      issueInventory("working-tree-branch"),
    );
    listPullRequestsMock.mockResolvedValue({
      data: [openPullRequest("CDE-1180-pr-head")],
      children: [],
      supported: true,
      available: true,
    });

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{
                  identifier: "CDE-1180",
                  title: "Adjust placeholder",
                  agentKind: "codex",
                }}
                cloneRepos={[advisingCloneRepo]}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const branchInput = await screen.findByLabelText(/branch for advising/i);
    await waitFor(() => expect(branchInput).toHaveValue("working-tree-branch"));

    await user.clear(branchInput);
    await user.type(branchInput, "typed-by-user");
    await user.click(screen.getByTestId("workspace-target-isolated"));

    expect(screen.getByLabelText(/branch for advising/i)).toHaveValue("typed-by-user");
  });

  it("sends the prefilled working-tree branch when starting the session", async () => {
    const user = userEvent.setup();
    fetchWorkspaceInventoryMock.mockResolvedValue(
      issueInventory("CDE-1180-advisor-groups-placeholder"),
    );

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route
            path="/projects/macro-markets/board"
            element={
              <StartIssueSessionDialog
                projectSlug="macro-markets"
                issue={{
                  identifier: "CDE-1180",
                  title: "Adjust placeholder",
                  agentKind: "codex",
                }}
                cloneRepos={[advisingCloneRepo]}
                open
                onOpenChange={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/branch for advising/i)).toHaveValue(
        "CDE-1180-advisor-groups-placeholder",
      ),
    );
    await user.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(createIssueSessionThreadMock).toHaveBeenCalledWith(
        "macro-markets",
        "CDE-1180",
        expect.objectContaining({
          cloneBranches: { advising: "CDE-1180-advisor-groups-placeholder" },
        }),
      ),
    );
  });
});
