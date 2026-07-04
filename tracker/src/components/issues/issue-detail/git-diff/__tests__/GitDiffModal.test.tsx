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
  GitDiffViewer: ({ file, viewMode }: { file: { path: string } | null; viewMode: string }) => (
    <div data-testid="git-diff-viewer" data-view-mode={viewMode}>
      {file?.path ?? "no-file"}
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
});
