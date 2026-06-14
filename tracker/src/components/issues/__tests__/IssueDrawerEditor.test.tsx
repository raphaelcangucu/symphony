import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import type { UseIssueEditorResult } from "@/hooks/useIssueEditor";
import type { Issue } from "@/types/issue";

const useIssueEditorMock = vi.hoisted(() => vi.fn<() => UseIssueEditorResult>());

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => useIssueEditorMock(),
}));

vi.mock("@/hooks/useIssuePullRequests", () => ({
  useIssuePullRequests: () => ({
    available: false,
    error: null,
    loading: false,
    pullRequests: [],
    refetch: vi.fn(),
    supported: false,
  }),
}));

vi.mock("@/hooks/useIssueComments", () => ({
  useIssueComments: () => ({
    addComment: vi.fn(),
    comments: [],
    error: null,
    loading: false,
    refetch: vi.fn(),
    workpad: null,
  }),
}));

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: () => ({
    data: null,
    error: null,
    loading: false,
    refresh: vi.fn(),
    restart: vi.fn(),
    restartServer: vi.fn(),
    start: vi.fn(),
    startServer: vi.fn(),
    stop: vi.fn(),
    stopServer: vi.fn(),
    startTunnel: vi.fn(),
  }),
}));

vi.mock("@/components/issues/issue-detail/SummaryTab", () => ({
  SummaryTab: () => <div>Summary</div>,
}));

vi.mock("@/components/issues/issue-detail/PullRequestTab", () => ({
  PullRequestTab: () => <div>Pull requests</div>,
}));

vi.mock("@/components/issues/issue-detail/CommentsTab", () => ({
  CommentsTab: () => <div>Comments</div>,
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

vi.mock("@/components/issues/issue-detail/ActivityTab", () => ({
  ActivityTab: () => <div>Activity</div>,
}));

vi.mock("@/components/issues/issue-detail/BlockersTab", () => ({
  BlockersTab: () => <div>Blockers</div>,
}));

vi.mock("@/components/issues/issue-detail/AgentTabs", () => ({
  AgentTabs: () => <div>Agent</div>,
}));

const unavailableEditor = {
  browser: { available: false, url: null, reason: "workspace_missing" as const },
  cursorDesktop: { available: false, url: null, reason: "workspace_missing" as const },
  loading: false,
};

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
  beforeEach(() => {
    useIssueEditorMock.mockReturnValue(unavailableEditor);
  });

  it("opens the workspace in a new tab when available", async () => {
    useIssueEditorMock.mockReturnValue({
      browser: {
        available: true,
        url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
        reason: null,
      },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
      loading: false,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} />);

    const trigger = await screen.findByRole("button", { name: /open in code/i });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: /vs code/i }));

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      "_blank",
      "noopener",
    );
  });

  it("opens Cursor when installed and the workspace is ready", async () => {
    useIssueEditorMock.mockReturnValue({
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

    const trigger = await screen.findByRole("button", { name: /open in code/i });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: /^cursor$/i }));

    expect(linkClick).toHaveBeenCalled();
    const anchor = linkClick.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("cursor://file/tmp/MAC-1");
  });

  it("opens via the '.' keyboard shortcut", async () => {
    useIssueEditorMock.mockReturnValue({
      browser: {
        available: true,
        url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
        reason: null,
      },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
      loading: false,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<IssueDrawer issue={issue} projectSlug="macro-markets" view="board" open onOpenChange={() => {}} />);
    await screen.findByRole("button", { name: /open in code/i });
    await waitFor(() => expect(screen.getByRole("button", { name: /open in code/i })).toBeEnabled());

    fireEvent.keyDown(window, { key: "." });

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      "_blank",
      "noopener",
    );
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
