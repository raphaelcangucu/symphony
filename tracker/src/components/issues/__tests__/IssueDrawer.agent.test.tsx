import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

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

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    available: false,
    loading: false,
    reason: "workspace_missing",
    url: null,
  }),
}));

vi.mock("@/components/assistant/IssueAuthoringPanel", () => ({
  IssueAuthoringPanel: ({
    projectSlug,
    identifier,
    view,
    compact,
  }: {
    projectSlug: string;
    identifier?: string;
    view: "board" | "list";
    compact?: boolean;
  }) => (
    <div data-testid="issue-authoring-panel">
      Authoring panel for {projectSlug}:{identifier}:{view}:{compact ? "compact" : "full"}
    </div>
  ),
}));

vi.mock("@/components/issues/issue-detail/AgentTab", () => ({
  AgentTab: ({ issue, execution }: { issue: Issue; execution?: AgentExecution }) => (
    <div data-testid="agent-execution-panel">
      Execution panel for {issue.identifier}:{execution?.status ?? "none"}
    </div>
  ),
}));

vi.mock("@/components/issues/issue-detail/PreviewTab", () => ({
  PreviewTab: () => <div>Preview panel</div>,
}));

vi.mock("@/components/issues/issue-detail/TerminalTab", () => ({
  TerminalTab: () => <div>Terminal panel</div>,
}));

const issue: Issue = {
  assignee: null,
  blockedBy: [],
  branchName: "feat/mac-1",
  createdAt: "2026-05-31T00:00:00Z",
  creator: "alice",
  description: "Draft docs and run the agent.",
  id: "1",
  identifier: "MAC-1",
  labels: [],
  position: 1,
  priority: 2,
  projectSlug: "macro-markets",
  status: "Todo",
  title: "Split agent detail tab",
  updatedAt: "2026-05-31T00:00:00Z",
  url: null,
};

const execution: AgentExecution = {
  error: null,
  issueIdentifier: "MAC-1",
  lastEvent: "turn.completed",
  lastEventAt: "2026-05-31T00:02:00Z",
  lastMessage: "Ready",
  retryAttempt: 0,
  runtimeSeconds: 42,
  sessionId: "session-1",
  startedAt: "2026-05-31T00:01:00Z",
  status: "live",
  tokens: null,
  turnCount: 1,
};

describe("IssueDrawer Agent tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to authoring and switches to the execution view", async () => {
    const user = userEvent.setup();

    render(
      <IssueDrawer
        issue={issue}
        projectSlug="macro-markets"
        view="list"
        execution={execution}
        open
        onOpenChange={() => {}}
        tab="agent"
      />,
    );

    expect(screen.getByRole("tab", { name: /authoring/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /execution/i })).toBeInTheDocument();
    expect(screen.getByTestId("issue-authoring-panel")).toHaveTextContent(
      "Authoring panel for macro-markets:MAC-1:list:compact",
    );
    expect(screen.queryByTestId("agent-execution-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /execution/i }));

    expect(screen.getByTestId("agent-execution-panel")).toHaveTextContent("Execution panel for MAC-1:live");
    expect(screen.queryByTestId("issue-authoring-panel")).not.toBeInTheDocument();
  });
});
