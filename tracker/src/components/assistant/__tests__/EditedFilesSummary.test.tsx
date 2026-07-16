import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditedFilesSummary } from "@/components/assistant/EditedFilesSummary";
import type { AssistantToolCall } from "@/services/assistant";

describe("EditedFilesSummary", () => {
  it("shows chip stats from the tool call's native file entries", () => {
    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        paths: ["/tmp/symphony_workspaces/macro-markets/back/docs/index.md"],
        files: [
          {
            path: "docs/index.md",
            status: "modified",
            patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} />);

    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.queryByText("Edited file diff")).not.toBeInTheDocument();
  });

  it("opens the workspace diff via callback instead of a thin dialog", async () => {
    const user = userEvent.setup();
    const onOpenWorkspaceDiff = vi.fn();
    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        files: [
          {
            path: "docs/index.md",
            status: "modified",
            patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} onOpenWorkspaceDiff={onOpenWorkspaceDiff} />);
    await user.click(screen.getByRole("button", { name: /view changes/i }));

    expect(onOpenWorkspaceDiff).toHaveBeenCalledWith({ path: "docs/index.md" });
    expect(screen.queryByText("Edited file diff")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edited-diff-viewer")).not.toBeInTheDocument();
  });

  it("still inserts a context chip from the + button", async () => {
    const user = userEvent.setup();
    const onInsertContext = vi.fn();
    const toolCall: AssistantToolCall = {
      id: "1",
      name: "edit_file",
      status: "complete",
      result: {
        files: [
          {
            path: "docs/index.md",
            status: "modified",
            patch: "diff --git a/docs/index.md b/docs/index.md\n-old\n+new\n",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    };

    render(<EditedFilesSummary toolCalls={[toolCall]} onInsertContext={onInsertContext} />);
    await user.click(screen.getByRole("button", { name: /add docs\/index\.md to context/i }));

    expect(onInsertContext).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "file",
        id: "docs/index.md",
        label: "index.md",
      }),
    );
  });
});
