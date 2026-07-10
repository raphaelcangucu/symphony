import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GitDiffModal from "../GitDiffModal";

const useGitDiffMock = vi.hoisted(() => vi.fn());
const useIssueCommitEvidenceMock = vi.hoisted(() => vi.fn());
const toastMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const commitGitDiffMock = vi.hoisted(() => vi.fn());
const commitThreadGitDiffMock = vi.hoisted(() => vi.fn());
const diffRefetchMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    message: (...args: unknown[]) => toastMessageMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/services/gitDiff", () => ({
  commitGitDiff: (...args: unknown[]) => commitGitDiffMock(...args),
  commitThreadGitDiff: (...args: unknown[]) => commitThreadGitDiffMock(...args),
}));

vi.mock("@/hooks/useGitDiff", () => ({
  useGitDiff: (...args: unknown[]) => useGitDiffMock(...args),
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

describe("GitDiffModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGitDiffMock.mockReset();
    useIssueCommitEvidenceMock.mockReset();
    toastMessageMock.mockReset();
    toastSuccessMock.mockReset();
    commitGitDiffMock.mockReset();
    commitThreadGitDiffMock.mockReset();
    diffRefetchMock.mockReset();
    useGitDiffMock.mockReturnValue({
      repos: [
        {
          repo: "frontend",
          files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" }],
        },
      ],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: diffRefetchMock,
    });
    useIssueCommitEvidenceMock.mockReturnValue({
      commits: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
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
    useGitDiffMock.mockReturnValue({
      repos: [
        {
          repo: "frontend",
          files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" }],
        },
        {
          repo: "backend",
          files: [{ path: "lib/Service.php", oldPath: null, status: "modified", patch: "@@\n+b\n" }],
        },
      ],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByRole("button", { name: /all repos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "frontend" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "backend" }));

    expect(screen.getByTestId("git-diff-viewer")).toHaveTextContent("backend/lib/Service.php");
    expect(screen.queryByText("frontend/src/App.tsx")).not.toBeInTheDocument();
  });

  it("commits workspace changes from the toolbar action", async () => {
    const user = userEvent.setup();
    commitGitDiffMock.mockResolvedValue({
      commits: [{ repo: "frontend", sha: "abc", message: "feat: save", files: ["src/App.tsx"] }],
      workspace: { path: "/tmp/ws", available: true },
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    await user.type(screen.getByLabelText(/commit message/i), "feat: save");
    await user.click(screen.getByRole("button", { name: /^commit changes$/i }));

    expect(commitGitDiffMock).toHaveBeenCalledWith("advising", "CDE-1", "feat: save");
    expect(diffRefetchMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Committed 1 repo.");
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

  it("shows branch status strip with ahead/behind on Branch tab", () => {
    useGitDiffMock.mockReturnValue({
      repos: [
        {
          repo: "frontend",
          branch: "feat/x",
          base: "main",
          ahead: 8,
          behind: 0,
          files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" }],
        },
      ],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);

    expect(screen.getByText(/feat\/x/i)).toBeInTheDocument();
    expect(screen.getByText(/main/i)).toBeInTheDocument();
    expect(screen.getByText(/8 ahead/i)).toBeInTheDocument();
  });

  it("shows working-tree strip and empty actions when uncommitted has no files", async () => {
    const user = userEvent.setup();
    useGitDiffMock.mockReturnValue({
      repos: [],
      workspace: { path: "/tmp/ws", available: true },
      loading: false,
      error: null,
      refetch: diffRefetchMock,
    });

    render(<GitDiffModal open onOpenChange={vi.fn()} projectSlug="advising" identifier="CDE-1" />);
    await user.click(screen.getByRole("tab", { name: /uncommitted/i }));

    expect(screen.getByText(/working tree/i)).toBeInTheDocument();
    expect(screen.getByText(/no uncommitted changes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view branch/i }));
    expect(screen.getByRole("tab", { name: /^branch$/i })).toHaveAttribute("data-state", "active");
  });
});
