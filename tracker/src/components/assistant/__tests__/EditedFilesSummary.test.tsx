import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditedFilesSummary } from "@/components/assistant/EditedFilesSummary";
import type { AssistantToolCall } from "@/services/assistant";

const getThreadGitDiffMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/gitDiff", () => ({
  getThreadGitDiff: (...args: unknown[]) => getThreadGitDiffMock(...args),
  getGitDiff: vi.fn(),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffViewer", () => ({
  GitDiffViewer: ({ file }: { file: { patch: string } | null }) => (
    <pre data-testid="edited-diff-viewer">{file?.patch ?? "no-file"}</pre>
  ),
}));

describe("EditedFilesSummary", () => {
  it("loads workspace diff when a tool call edited a file but did not include a patch", async () => {
    const user = userEvent.setup();
    getThreadGitDiffMock.mockResolvedValue({
      repos: [
        {
          repo: "back",
          files: [
            {
              path: "docs/index.md",
              oldPath: null,
              status: "modified",
              patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
            },
          ],
        },
      ],
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

    await waitFor(() => expect(getThreadGitDiffMock).toHaveBeenCalledWith(7990, "uncommitted"));
    await waitFor(() => expect(screen.getByText("+1")).toBeInTheDocument());
    expect(screen.getByText("-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view changes/i }));
    expect(screen.getByTestId("edited-diff-viewer")).toHaveTextContent("+new");
  });
});
