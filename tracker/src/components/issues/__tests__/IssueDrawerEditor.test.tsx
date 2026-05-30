import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import * as editorService from "@/services/editor";
import type { Issue } from "@/types/issue";

vi.mock("@/services/pullRequests", () => ({
  listPullRequests: vi.fn().mockResolvedValue({ data: [], supported: false, available: false }),
}));

vi.mock("@/services/comments", () => ({
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
}));

const issue = {
  id: "1",
  identifier: "MAC-1",
  title: "Open me in VS Code",
  status: "Todo",
  priority: 0,
  assignee: null,
  projectSlug: "macro-markets",
  blockedBy: [],
  labels: [],
} as unknown as Issue;

describe("IssueDrawer editor button", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens the workspace in a new tab when available", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" open onOpenChange={() => {}} />);

    const button = await screen.findByRole("button", { name: /open in vs code/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      "_blank",
      "noopener",
    );
  });

  it("opens via the '.' keyboard shortcut", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" open onOpenChange={() => {}} />);
    await screen.findByRole("button", { name: /open in vs code/i });
    await waitFor(() => expect(screen.getByRole("button", { name: /open in vs code/i })).toBeEnabled());

    fireEvent.keyDown(window, { key: "." });

    expect(open).toHaveBeenCalledTimes(1);
  });
});
