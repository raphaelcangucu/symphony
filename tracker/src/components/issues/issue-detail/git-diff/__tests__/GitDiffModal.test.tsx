import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GitDiffModal from "../GitDiffModal";

const useGitDiffStatsMock = vi.hoisted(() => vi.fn());
const useGitDiffFilesMock = vi.hoisted(() => vi.fn());
const useGitDiffPatchMock = vi.hoisted(() => vi.fn());
const useIssueCommitEvidenceMock = vi.hoisted(() => vi.fn());
const toastMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const commitGitDiffMock = vi.hoisted(() => vi.fn());
const commitThreadGitDiffMock = vi.hoisted(() => vi.fn());
const generateCommitMessageMock = vi.hoisted(() => vi.fn());
const getGitDiffSummariesMock = vi.hoisted(() => vi.fn());
const pushGitDiffMock = vi.hoisted(() => vi.fn());
const statsRefetchMock = vi.hoisted(() => vi.fn());
const filesRefetchMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    message: (...args: unknown[]) => toastMessageMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/services/gitDiff", () => ({
  commitGitDiff: (...args: unknown[]) => commitGitDiffMock(...args),
  commitThreadGitDiff: (...args: unknown[]) => commitThreadGitDiffMock(...args),
  generateCommitMessage: (...args: unknown[]) => generateCommitMessageMock(...args),
  getGitDiffSummaries: (...args: unknown[]) => getGitDiffSummariesMock(...args),
  pushGitDiff: (...args: unknown[]) => pushGitDiffMock(...args),
}));

vi.mock("@/hooks/useGitDiffStats", () => ({
  useGitDiffStats: (...args: unknown[]) => useGitDiffStatsMock(...args),
}));

vi.mock("@/hooks/useGitDiffFiles", () => ({
  useGitDiffFiles: (...args: unknown[]) => useGitDiffFilesMock(...args),
}));

vi.mock("@/hooks/useGitDiffPatch", () => ({
  useGitDiffPatch: (...args: unknown[]) => useGitDiffPatchMock(...args),
}));

vi.mock("@/hooks/useIssueCommitEvidence", () => ({
  useIssueCommitEvidence: (...args: unknown[]) => useIssueCommitEvidenceMock(...args),
}));

vi.mock("@/services/commitEvidence", () => ({
  getCommitEvidence: vi.fn(),
}));

vi.mock("../GitDiffViewer", () => ({
  GitDiffViewer: ({
    file,
    viewMode,
    comments,
    onSaveComment,
  }: {
    file: { path: string } | null;
    viewMode: string;
    comments?: { id: string; comment: string }[];
    onSaveComment?: (input: {
      side: "additions" | "deletions";
      lineNumber: number;
      lineText: string | null;
      comment: string;
    }) => void;
  }) => (
    <div data-testid="git-diff-viewer" data-view-mode={viewMode} data-comment-count={comments?.length ?? "off"}>
      {file?.path ?? "no-file"}
      {onSaveComment ? (
        <button
          type="button"
          onClick={() =>
            onSaveComment({ side: "additions", lineNumber: 3, lineText: "const x = 1;", comment: "Fix this line" })
          }
        >
          mock add comment
        </button>
      ) : null}
    </div>
  ),
}));

function fileEntry(overrides: Partial<{ repo: string; path: string; additions: number; deletions: number }> = {}) {
  return {
    repo: overrides.repo ?? "frontend",
    path: overrides.path ?? "src/App.tsx",
    oldPath: null,
    status: "modified",
    additions: overrides.additions ?? 1,
    deletions: overrides.deletions ?? 0,
    binary: false,
  };
}

describe("GitDiffModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGitDiffStatsMock.mockReset();
    useGitDiffFilesMock.mockReset();
    useGitDiffPatchMock.mockReset();
    useIssueCommitEvidenceMock.mockReset();
    toastMessageMock.mockReset();
    toastSuccessMock.mockReset();
    commitGitDiffMock.mockReset();
    commitThreadGitDiffMock.mockReset();
    generateCommitMessageMock.mockReset();
    getGitDiffSummariesMock.mockReset();
    pushGitDiffMock.mockReset();
    statsRefetchMock.mockReset();
    filesRefetchMock.mockReset();
    getGitDiffSummariesMock.mockResolvedValue({
      summaries: [],
      workspace: { path: "/tmp/ws", available: true },
    });

    useGitDiffStatsMock.mockReturnValue({
      stats: [{ repo: "frontend", branch: null, base: null, filesChanged: 1, additions: 1, deletions: 0, untracked: 0 }],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: statsRefetchMock,
    });
    useGitDiffFilesMock.mockReturnValue({
      files: [fileEntry()],
      total: 1,
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
      loadMore: vi.fn(),
      refetch: filesRefetchMock,
    });
    useGitDiffPatchMock.mockReturnValue({
      file: { path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" },
      loading: false,
      error: null,
    });
    useIssueCommitEvidenceMock.mockReturnValue({
      commits: [],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("does not claim the workspace is unavailable when stats cleared but commit evidence has a path", async () => {
    const user = userEvent.setup();
    useGitDiffStatsMock.mockReturnValue({
      stats: [],
      workspace: null,
      loading: false,
      error: null,
      refetch: statsRefetchMock,
    });
    useIssueCommitEvidenceMock.mockReturnValue({
      commits: [],
      workspace: { path: "/home/code/advising-workspaces/advising/CDE-1131", available: true },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1131" />);
    await user.click(screen.getByRole("tab", { name: /commits/i }));

    expect(screen.getByText(/CDE-1131/)).toHaveTextContent("/home/code/advising-workspaces/advising/CDE-1131");
    expect(screen.queryByText(/workspace unavailable/i)).not.toBeInTheDocument();
  });

  it("renders repo-prefixed workspace files and forwards the selected view mode", async () => {
    const user = userEvent.setup();

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByTestId("git-diff-viewer")).toHaveTextContent("frontend/src/App.tsx");
    expect(screen.getByTestId("git-diff-viewer")).toHaveAttribute("data-view-mode", "split");

    await user.click(screen.getByRole("button", { name: /unified/i }));
    expect(screen.getByTestId("git-diff-viewer")).toHaveAttribute("data-view-mode", "unified");
    expect(window.localStorage.getItem("symphony.tracker.diff.viewMode")).toBe("unified");
  });

  it("shows repository navigation for multi-repo diffs", async () => {
    const user = userEvent.setup();
    useGitDiffStatsMock.mockReturnValue({
      stats: [
        { repo: "frontend", branch: null, base: null, filesChanged: 1, additions: 1, deletions: 0, untracked: 0 },
        { repo: "backend", branch: null, base: null, filesChanged: 1, additions: 1, deletions: 0, untracked: 0 },
      ],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: statsRefetchMock,
    });
    useGitDiffFilesMock.mockReturnValue({
      files: [fileEntry({ repo: "frontend", path: "src/App.tsx" }), fileEntry({ repo: "backend", path: "lib/Service.php" })],
      total: 2,
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
      loadMore: vi.fn(),
      refetch: filesRefetchMock,
    });
    useGitDiffPatchMock.mockReturnValue({
      file: { path: "lib/Service.php", oldPath: null, status: "modified", patch: "@@\n+b\n" },
      loading: false,
      error: null,
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByRole("button", { name: /all repos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "frontend" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "backend" }));

    expect(useGitDiffFilesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ repo: "backend", type: "branch" }),
    );
  });

  it("commits workspace changes from the toolbar action", async () => {
    const user = userEvent.setup();
    commitGitDiffMock.mockResolvedValue({
      commits: [{ repo: "frontend", sha: "abc", message: "feat: save", files: ["src/App.tsx"] }],
      workspace: { path: "/tmp/ws", available: true },
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    await user.type(screen.getByLabelText(/^commit message$/i), "feat: save");
    await user.click(screen.getByRole("button", { name: /^commit changes$/i }));

    expect(commitGitDiffMock).toHaveBeenCalledWith("advising", "CDE-1", "feat: save");
    expect(filesRefetchMock).toHaveBeenCalled();
    expect(statsRefetchMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Committed 1 repo.");
  });

  it("fills the commit message generated by the sparkle action", async () => {
    const user = userEvent.setup();
    generateCommitMessageMock.mockResolvedValue("feat: generated");

    render(
      <GitDiffModal
        open
        onOpenChange={vi.fn()}
        projectSlug="advising"
        identifier="CDE-1"
        initialCommitDialogOpen
      />,
    );

    await user.click(await screen.findByRole("button", { name: /generate commit message/i }));

    expect(generateCommitMessageMock).toHaveBeenCalledWith("advising", "CDE-1");
    expect(await screen.findByDisplayValue("feat: generated")).toBeInTheDocument();
  });

  it("pushes workspace branches when summaries report commits ahead", async () => {
    const user = userEvent.setup();
    getGitDiffSummariesMock.mockResolvedValue({
      summaries: [{ repo: "frontend", branch: "feat/CDE-1", aheadCount: 1, dirty: false }],
      workspace: { path: "/tmp/ws", available: true },
    });
    pushGitDiffMock.mockResolvedValue({
      results: [{ repo: "frontend", ok: true }],
      workspace: { path: "/tmp/ws", available: true },
    });

    render(
      <GitDiffModal
        open
        onOpenChange={vi.fn()}
        projectSlug="advising"
        identifier="CDE-1"
        initialCommitDialogOpen
      />,
    );

    const pushButton = await screen.findByRole("button", { name: /^push$/i });
    await user.click(pushButton);

    expect(pushGitDiffMock).toHaveBeenCalledWith("advising", "CDE-1");
  });

  it("collects line comments and sends the review prompt to the agent", async () => {
    const user = userEvent.setup();
    const onSendReview = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <GitDiffModal
        open
        onOpenChange={onOpenChange}
        projectSlug="advising"
        identifier="CDE-1"
        onSendReview={onSendReview}
      />,
    );

    expect(screen.queryByRole("button", { name: /send .* to agent/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "mock add comment" }));
    await user.click(screen.getByRole("button", { name: /send 1 to agent/i }));

    expect(onSendReview).toHaveBeenCalledTimes(1);
    const prompt = onSendReview.mock.calls[0][0] as string;
    expect(prompt).toContain("### (branch) — frontend/src/App.tsx");
    expect(prompt).toContain("Fix this line");
    expect(prompt).toContain("line 3");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("keeps review mode off when no onSendReview handler is provided", () => {
    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByTestId("git-diff-viewer")).toHaveAttribute("data-comment-count", "off");
    expect(screen.queryByRole("button", { name: "mock add comment" })).not.toBeInTheDocument();
  });

  it("enables review on Commits and includes commit note + line comment in the prompt", async () => {
    const user = userEvent.setup();
    const onSendReview = vi.fn();
    useIssueCommitEvidenceMock.mockReturnValue({
      commits: [
        {
          repo: "frontend",
          sha: "abcdef123456",
          shortSha: "abcdef1",
          message: "docs: plan",
          author: "agent",
          authoredAt: "2026-07-10T00:00:00Z",
          filesChanged: 1,
          insertions: 10,
          deletions: 0,
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getCommitEvidence } = await import("@/services/commitEvidence");
    vi.mocked(getCommitEvidence).mockResolvedValue({
      repo: "frontend",
      sha: "abcdef123456",
      shortSha: "abcdef1",
      message: "docs: plan",
      author: "agent",
      authoredAt: "2026-07-10T00:00:00Z",
      filesChanged: 1,
      insertions: 10,
      deletions: 0,
      files: [{ path: "docs/plan.md", oldPath: null, status: "added", patch: "@@\n+hello\n" }],
    });

    render(
      <GitDiffModal
        open
        onOpenChange={vi.fn()}
        projectSlug="advising"
        identifier="CDE-1"
        onSendReview={onSendReview}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /commits/i }));
    const note = await screen.findByLabelText(/commit note/i);
    await user.type(note, "use as context");
    await user.click(await screen.findByRole("button", { name: "mock add comment" }));
    await user.click(screen.getByRole("button", { name: /send .* to agent/i }));

    const prompt = onSendReview.mock.calls[0][0] as string;
    expect(prompt).toContain("## Commit notes");
    expect(prompt).toContain("use as context");
    expect(prompt).toContain("Fix this line");
    expect(prompt).toMatch(/commit|abcdef1|frontend/i);
  });

  it("isolates line comments to the selected commit", async () => {
    const user = userEvent.setup();
    const onSendReview = vi.fn();
    const commitA = {
      repo: "frontend",
      sha: "aaaaaaaaaaaa",
      shortSha: "aaaaaaa",
      message: "feat: first",
      author: "agent",
      authoredAt: "2026-07-10T00:00:00Z",
      filesChanged: 1,
      insertions: 5,
      deletions: 0,
    };
    const commitB = {
      repo: "backend",
      sha: "bbbbbbbbbbbb",
      shortSha: "bbbbbbb",
      message: "feat: second",
      author: "agent",
      authoredAt: "2026-07-10T01:00:00Z",
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
    };
    useIssueCommitEvidenceMock.mockReturnValue({
      commits: [commitA, commitB],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getCommitEvidence } = await import("@/services/commitEvidence");
    vi.mocked(getCommitEvidence).mockImplementation(async (_project, _identifier, repo, sha) => {
      if (repo === commitA.repo && sha === commitA.sha) {
        return {
          ...commitA,
          files: [{ path: "src/a.ts", oldPath: null, status: "modified", patch: "@@\n+a\n" }],
        };
      }
      return {
        ...commitB,
        files: [{ path: "lib/b.ts", oldPath: null, status: "modified", patch: "@@\n+b\n" }],
      };
    });

    render(
      <GitDiffModal
        open
        onOpenChange={vi.fn()}
        projectSlug="advising"
        identifier="CDE-1"
        onSendReview={onSendReview}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /commits/i }));
    await screen.findByRole("button", { name: "mock add comment" });
    await user.click(screen.getByRole("button", { name: "mock add comment" }));
    expect(screen.getByTestId("git-diff-viewer")).toHaveAttribute("data-comment-count", "1");

    await user.click(screen.getByRole("button", { name: /feat: second/i }));
    expect(screen.getByTestId("git-diff-viewer")).toHaveAttribute("data-comment-count", "0");
  });

  it("shows branch status strip with branch/base on Branch tab", () => {
    useGitDiffStatsMock.mockReturnValue({
      stats: [{ repo: "frontend", branch: "feat/x", base: "main", filesChanged: 1, additions: 1, deletions: 0, untracked: 0 }],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: statsRefetchMock,
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByText(/feat\/x/i)).toBeInTheDocument();
    expect(screen.getByText(/main/i)).toBeInTheDocument();
  });

  it("shows working-tree strip and empty actions when uncommitted has no files", async () => {
    const user = userEvent.setup();
    useGitDiffStatsMock.mockReturnValue({
      stats: [],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: statsRefetchMock,
    });
    useGitDiffFilesMock.mockReturnValue({
      files: [],
      total: 0,
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
      loadMore: vi.fn(),
      refetch: filesRefetchMock,
    });
    useGitDiffPatchMock.mockReturnValue({ file: null, loading: false, error: null });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);
    await user.click(screen.getByRole("tab", { name: /uncommitted/i }));

    expect(screen.getByTestId("uncommitted-summary-strip")).toBeInTheDocument();
    expect(screen.getByText(/no uncommitted changes/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("uncommitted-empty-refresh"));
    expect(filesRefetchMock).toHaveBeenCalled();
    expect(statsRefetchMock).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /view branch/i }));
    expect(screen.getByRole("tab", { name: /^branch$/i })).toHaveAttribute("data-state", "active");
  });

  it("shows a load-more action when the file list has additional pages", async () => {
    const user = userEvent.setup();
    const loadMoreMock = vi.fn();
    useGitDiffFilesMock.mockReturnValue({
      files: [fileEntry()],
      total: 5,
      loading: false,
      loadingMore: false,
      hasMore: true,
      error: null,
      loadMore: loadMoreMock,
      refetch: filesRefetchMock,
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    await user.click(screen.getByRole("button", { name: /load more/i }));
    expect(loadMoreMock).toHaveBeenCalledTimes(1);
  });
});
