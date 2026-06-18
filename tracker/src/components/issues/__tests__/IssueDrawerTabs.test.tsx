import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import type { UseIssueEditorResult } from "@/hooks/useIssueEditor";
import { DEFAULT_ISSUE_TAB, type IssueTab } from "@/lib/workspaceRoutes";
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

// SummaryTab is heavy (markdown + inline editors); mock it so these tests focus
// purely on tab switching/navigation and stay fast.
vi.mock("@/components/issues/issue-detail/SummaryTab", () => ({
  SummaryTab: () => <div>Summary panel</div>,
}));

vi.mock("@/components/issues/issue-detail/PullRequestTab", () => ({
  PullRequestTab: () => <div>Pull requests panel</div>,
}));

vi.mock("@/components/issues/issue-detail/CommentsTab", () => ({
  CommentsTab: () => <div>Comments panel</div>,
}));

vi.mock("@/components/issues/issue-detail/PreviewTab", () => ({
  PreviewTab: () => <div>Preview panel</div>,
}));

vi.mock("@/components/issues/issue-detail/TerminalTab", () => ({
  TerminalTab: () => <div>Terminal panel</div>,
}));

vi.mock("@/components/issues/issue-detail/ActivityTab", () => ({
  ActivityTab: () => <div>Activity panel</div>,
}));

vi.mock("@/components/issues/issue-detail/AgentTabs", () => ({
  AgentTabs: () => <div>Agent panel</div>,
}));

const unavailableEditor: UseIssueEditorResult = {
  browser: { available: false, url: null, reason: "workspace_missing" },
  cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
  loading: false,
};

const issue = {
  id: "1",
  identifier: "MAC-1",
  title: "Tabbed issue",
  status: "Todo",
  priority: 0,
  assignee: null,
  projectSlug: "macro-markets",
  blockedBy: [],
  labels: [],
} as unknown as Issue;

function ControlledDrawer({ onTabChange }: { onTabChange?: (tab: IssueTab) => void }) {
  const [tab, setTab] = useState<IssueTab>(DEFAULT_ISSUE_TAB);
  return (
    <IssueDrawer
      issue={issue}
      projectSlug="macro-markets"
      view="board"
      open
      onOpenChange={() => {}}
      tab={tab}
      onTabChange={(next) => {
        setTab(next);
        onTabChange?.(next);
      }}
    />
  );
}

describe("IssueDrawer tab navigation", () => {
  beforeEach(() => {
    useIssueEditorMock.mockReturnValue(unavailableEditor);
  });

  it("switches the visible panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ControlledDrawer />);

    expect(await screen.findByText("Summary panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /comments/i }));
    expect(await screen.findByText("Comments panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /pull request/i }));
    expect(await screen.findByText("Pull requests panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /preview/i }));
    expect(await screen.findByText("Preview panel")).toBeInTheDocument();
  });

  it("reports every selected tab through onTabChange (for route navigation)", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<ControlledDrawer onTabChange={onTabChange} />);

    await screen.findByRole("tab", { name: /summary/i });

    await user.click(screen.getByRole("tab", { name: /evidence/i }));
    await user.click(screen.getByRole("tab", { name: /activity/i }));
    await user.click(screen.getByRole("tab", { name: /terminal/i }));

    expect(onTabChange).toHaveBeenNthCalledWith(1, "evidence");
    expect(onTabChange).toHaveBeenNthCalledWith(2, "activity");
    expect(onTabChange).toHaveBeenNthCalledWith(3, "terminal");
  });

  it("marks the active tab from the controlled tab prop", async () => {
    render(
      <IssueDrawer
        issue={issue}
        projectSlug="macro-markets"
        view="board"
        open
        onOpenChange={() => {}}
        tab="preview"
        onTabChange={() => {}}
      />,
    );

    const previewTab = await screen.findByRole("tab", { name: /preview/i });
    expect(previewTab).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Preview panel")).toBeInTheDocument();
  });
});
