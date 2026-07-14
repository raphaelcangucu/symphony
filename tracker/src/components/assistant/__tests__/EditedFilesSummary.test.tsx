import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditedFilesSummary } from "@/components/assistant/EditedFilesSummary";
import type { AssistantToolCall } from "@/services/assistant";

const getThreadGitDiffFilesMock = vi.hoisted(() => vi.fn());
const getThreadGitDiffPatchMock = vi.hoisted(() => vi.fn());
const getGitDiffFilesMock = vi.hoisted(() => vi.fn());
const getGitDiffPatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/gitDiff", () => ({
  getThreadGitDiffFiles: (...args: unknown[]) => getThreadGitDiffFilesMock(...args),
  getThreadGitDiffPatch: (...args: unknown[]) => getThreadGitDiffPatchMock(...args),
  getGitDiffFiles: (...args: unknown[]) => getGitDiffFilesMock(...args),
  getGitDiffPatch: (...args: unknown[]) => getGitDiffPatchMock(...args),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffViewer", () => ({
  GitDiffViewer: ({ file }: { file: { patch: string } | null }) => (
    <pre data-testid="edited-diff-viewer">{file?.patch ?? "no-file"}</pre>
  ),
}));

describe("EditedFilesSummary", () => {
  it("shows chip stats from the tool call's native file entries without any network call", () => {
    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        paths: ["/tmp/symphony_workspaces/macro-markets/back/docs/index.md"],
        files: [{ path: "docs/index.md", status: "modified", patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n", additions: 1, deletions: 1 }],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} threadId={7990} />);

    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(getThreadGitDiffFilesMock).not.toHaveBeenCalled();
    expect(getThreadGitDiffPatchMock).not.toHaveBeenCalled();
  });

  it("opening a chip with a native patch shows it without fetching anything", async () => {
    const user = userEvent.setup();
    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        files: [{ path: "docs/index.md", status: "modified", patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n", additions: 1, deletions: 1 }],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} threadId={7990} />);
    await user.click(screen.getByRole("button", { name: /view changes/i }));

    expect(screen.getByTestId("edited-diff-viewer")).toHaveTextContent("+new");
    expect(getThreadGitDiffFilesMock).not.toHaveBeenCalled();
    expect(getThreadGitDiffPatchMock).not.toHaveBeenCalled();
  });

  it("fetches only that file's patch via the files+patch APIs when opening a chip without a native patch", async () => {
    const user = userEvent.setup();
    getThreadGitDiffFilesMock.mockResolvedValue({
      files: [{ repo: "back", path: "docs/index.md", oldPath: null, status: "modified", additions: 1, deletions: 1, binary: false }],
      total: 1,
      limit: 50,
      nextCursor: null,
      workspace: { path: "/tmp/symphony_workspaces/macro-markets", available: true },
    });
    getThreadGitDiffPatchMock.mockResolvedValue({
      repo: "back",
      path: "docs/index.md",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
      workspace: { path: "/tmp/symphony_workspaces/macro-markets", available: true },
    });

    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        paths: ["/tmp/symphony_workspaces/macro-markets/back/docs/index.md"],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} threadId={7990} />);

    await user.click(screen.getByRole("button", { name: /view changes/i }));

    await waitFor(() =>
      expect(getThreadGitDiffFilesMock).toHaveBeenCalledWith(
        7990,
        "uncommitted",
        expect.objectContaining({ q: "index.md" }),
      ),
    );
    await waitFor(() => expect(getThreadGitDiffPatchMock).toHaveBeenCalledWith(7990, "uncommitted", "back", "docs/index.md", expect.anything()));
    await waitFor(() => expect(screen.getByTestId("edited-diff-viewer")).toHaveTextContent("+new"));

    // Never falls back to fetching the full workspace diff.
    expect(getGitDiffFilesMock).not.toHaveBeenCalled();
    expect(getGitDiffPatchMock).not.toHaveBeenCalled();
  });

  it("resolves via the project files+patch APIs when not scoped to a thread", async () => {
    const user = userEvent.setup();
    getGitDiffFilesMock.mockResolvedValue({
      files: [{ repo: "back", path: "docs/index.md", oldPath: null, status: "modified", additions: 1, deletions: 1, binary: false }],
      total: 1,
      limit: 50,
      nextCursor: null,
      workspace: { path: "/tmp/ws", available: true },
    });
    getGitDiffPatchMock.mockResolvedValue({
      repo: "back",
      path: "docs/index.md",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
      workspace: { path: "/tmp/ws", available: true },
    });

    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: { paths: ["/tmp/ws/back/docs/index.md"] },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} projectSlug="demo" issueIdentifier="ABC-1" />);
    await user.click(screen.getByRole("button", { name: /view changes/i }));

    await waitFor(() => expect(getGitDiffFilesMock).toHaveBeenCalledWith("demo", "ABC-1", "uncommitted", expect.anything()));
    await waitFor(() => expect(getGitDiffPatchMock).toHaveBeenCalledWith("demo", "ABC-1", "uncommitted", "back", "docs/index.md", expect.anything()));
    await waitFor(() => expect(screen.getByTestId("edited-diff-viewer")).toHaveTextContent("+new"));
  });
});
