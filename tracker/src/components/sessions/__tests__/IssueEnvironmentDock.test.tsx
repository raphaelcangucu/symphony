import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueEnvironmentDock } from "@/components/sessions/IssueEnvironmentDock";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/hooks/useWorkspaceDiffStats", () => ({
  useWorkspaceDiffStats: () => ({ additions: 12, deletions: 4 }),
}));

vi.mock("@/hooks/useWorkspaceRepoSummaries", () => ({
  useWorkspaceRepoSummaries: () => ({
    localBranch: "feature/local-work",
    aheadCount: 2,
    dirty: true,
    summaries: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useIssuePullRequests", () => ({
  useIssuePullRequests: () => ({
    pullRequests: [
      {
        number: 42,
        title: "Add Ambiente branches",
        url: "https://github.com/example/symphony/pull/42",
        state: "open",
        repo: "example/symphony",
        origin: "auto",
        rawState: "OPEN",
        isDraft: false,
        merged: false,
        headRef: "feature/local-work",
        baseRef: "main",
        author: null,
        createdAt: null,
        updatedAt: null,
        mergedAt: null,
        mergeable: null,
        checksState: null,
        pipelines: [],
        statuses: [],
        conversation: [],
        baseBehindBy: null,
        monitor: null,
      },
    ],
    children: [],
    supported: true,
    available: true,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/services/issues", () => ({
  getIssue: vi.fn().mockResolvedValue({ branchName: "issue/510-ambiente" }),
}));

vi.mock("@/hooks/useHorizontalPanelResize", () => ({
  useHorizontalPanelResize: () => ({
    width: 280,
    isResizing: false,
    onResizePointerDown: vi.fn(),
    onResizePointerUp: vi.fn(),
  }),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: ({
    openRequestId,
    openCommitDialogRequestId,
  }: {
    openRequestId?: number;
    openCommitDialogRequestId?: number;
  }) => (
    <div
      data-testid="git-diff-launcher"
      data-open-commit-request-id={openCommitDialogRequestId ?? 0}
      data-open-request-id={openRequestId ?? 0}
    />
  ),
}));

describe("IssueEnvironmentDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders changes, sources, and closes from the header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const containerRef = createRef<HTMLDivElement>();

    render(
      <MemoryRouter>
        <div ref={containerRef}>
          <IssueEnvironmentDock
            projectSlug="macro-markets"
            issueIdentifier="510"
            view="board"
            splitContainerRef={containerRef}
            onClose={onClose}
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("environment-dock")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−4")).toBeInTheDocument();
    expect(await screen.findByText("feature/local-work")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("issue/510-ambiente")).toBeInTheDocument();
    expect(screen.getByText("Issue")).toBeInTheDocument();
    expect(screen.getByText("Linked PRs")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("macro-markets")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close environment/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("bumps compare request id when Compare is clicked", async () => {
    const user = userEvent.setup();
    const containerRef = createRef<HTMLDivElement>();

    render(
      <MemoryRouter>
        <div ref={containerRef}>
          <IssueEnvironmentDock
            projectSlug="macro-markets"
            issueIdentifier="510"
            view="board"
            splitContainerRef={containerRef}
            onClose={vi.fn()}
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-request-id", "0");
    await user.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-request-id", "1");
  });

  it("bumps commit request id when Commit & push is clicked", async () => {
    const user = userEvent.setup();
    const containerRef = createRef<HTMLDivElement>();

    render(
      <MemoryRouter>
        <div ref={containerRef}>
          <IssueEnvironmentDock
            projectSlug="macro-markets"
            issueIdentifier="510"
            view="board"
            splitContainerRef={containerRef}
            onClose={vi.fn()}
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-commit-request-id", "0");
    await user.click(screen.getByRole("button", { name: /commit & push/i }));
    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-commit-request-id", "1");
  });
});
