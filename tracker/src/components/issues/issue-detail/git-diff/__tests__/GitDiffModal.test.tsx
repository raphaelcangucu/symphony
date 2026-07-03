import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GitDiffModal from "../GitDiffModal";

const useGitDiffMock = vi.hoisted(() => vi.fn());
const useIssueCommitEvidenceMock = vi.hoisted(() => vi.fn());

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
      refetch: vi.fn(),
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
});
