import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import * as useIssueEditorHook from "@/hooks/useIssueEditor";
import * as editorService from "@/services/editor";
import type { Issue } from "@/types/issue";

vi.mock("@/services/pullRequests", () => ({
  listPullRequests: vi.fn().mockResolvedValue({ data: [], supported: false, available: false }),
}));

vi.mock("@/services/comments", () => ({
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
}));

vi.mock("@/components/issues/issue-detail/PreviewTab", () => ({
  PreviewTab: ({ projectSlug, issueIdentifier }: { projectSlug: string; issueIdentifier: string }) => (
    <div>
      Preview for {projectSlug}:{issueIdentifier}
    </div>
  ),
}));

vi.mock("@/components/issues/issue-detail/TerminalTab", () => ({
  TerminalTab: () => <div>Terminal output</div>,
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
  const unavailableTargets = {
    browser: { available: false, url: null, reason: "workspace_missing" as const },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" as const },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(editorService, "fetchEditorTargets").mockResolvedValue(unavailableTargets);
  });

  it("opens the workspace in a new tab when available", async () => {
    vi.spyOn(editorService, "fetchEditorTargets").mockResolvedValue({
      browser: {
        available: true,
        url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
        reason: null,
      },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} />);

    const trigger = await screen.findByRole("button", { name: /open in vs code/i });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: /vs code/i }));

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      "_blank",
      "noopener",
    );
  });

  it("opens Cursor Desktop when installed and the workspace is ready", async () => {
    vi.spyOn(useIssueEditorHook, "useIssueEditor").mockReturnValue({
      browser: { available: false, url: null, reason: "disabled" },
      cursorDesktop: {
        available: true,
        url: "cursor://file/tmp/MAC-1",
        reason: null,
      },
      loading: false,
    });

    const user = userEvent.setup();
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, "click");

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} />);

    const trigger = await screen.findByRole("button", { name: /open in vs code/i });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: /cursor desktop/i }));

    expect(linkClick).toHaveBeenCalled();
    const anchor = linkClick.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("cursor://file/tmp/MAC-1");
  });

  it("opens via the '.' keyboard shortcut", async () => {
    vi.spyOn(editorService, "fetchEditorTargets").mockResolvedValue({
      browser: {
        available: true,
        url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
        reason: null,
      },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} />);
    await screen.findByRole("button", { name: /open in vs code/i });
    await waitFor(() => expect(screen.getByRole("button", { name: /open in vs code/i })).toBeEnabled());

    fireEvent.keyDown(window, { key: "." });

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("renders the preview tab for the selected issue", async () => {
    render(
      <IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} tab="preview" />,
    );

    const previewTab = await screen.findByRole("tab", { name: /preview/i });
    expect(previewTab).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Preview for macro-markets:MAC-1")).toBeInTheDocument();
  });
});
