import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

vi.mock("@/hooks/useMeIdentities", () => ({
  useMeIdentities: () => ({ identities: [], loading: false, error: null }),
}));

vi.mock("@/services/issues", async () => {
  const actual = await vi.importActual<typeof import("@/services/issues")>("@/services/issues");
  return {
    ...actual,
    getIssueFormOptions: vi.fn().mockResolvedValue({
      agents: [],
      assignees: [],
      effectiveAgent: "codex",
      labels: [],
      statuses: [],
    }),
  };
});

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

vi.mock("@/hooks/useIssueEvidence", () => ({
  useIssueEvidence: () => ({
    error: null,
    loading: false,
    records: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useIssueCommitEvidence", () => ({
  useIssueCommitEvidence: () => ({
    commits: [],
    workspace: null,
    error: null,
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: false, url: null, reason: "workspace_missing" },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
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

vi.mock("@/components/sessions/StartIssueSessionDialog", () => ({
  StartIssueSessionDialog: () => null,
}));

vi.mock("@/hooks/useArchiveChat", () => ({
  useArchiveChat: () => ({ archiving: false, archiveChat: vi.fn() }),
}));

vi.mock("@/hooks/useIssueSessions", () => ({
  useIssueSessions: () => ({
    executionSession: {
      issueIdentifier: "MAC-1",
      title: "Split agent detail tab",
      agentKind: "codex",
      status: "live",
      bucket: "active",
      lastEventAt: "2026-05-31T00:02:00Z",
      turnCount: 1,
      runtimeSeconds: 42,
      startedAt: "2026-05-31T00:01:00Z",
      goalObjective: null,
      execution: {
        status: "live",
        executionSessionId: 42,
      },
    },
    executionSessions: [
      {
        issueIdentifier: "MAC-1",
        title: "Split agent detail tab",
        agentKind: "codex",
        status: "live",
        bucket: "active",
        lastEventAt: "2026-05-31T00:02:00Z",
        turnCount: 1,
        runtimeSeconds: 42,
        startedAt: "2026-05-31T00:01:00Z",
        goalObjective: null,
        execution: {
          status: "live",
          executionSessionId: 42,
        },
      },
    ],
    chatSessions: [
      {
        id: 7,
        scope: "issue_session",
        agentKind: "codex",
        projectSlug: "macro-markets",
        projectName: "Macro Markets",
        issueIdentifier: "MAC-1",
        title: "Build pass 1",
        status: "active",
        preview: "Start with the menu",
        updatedAt: "2026-05-31T00:03:00Z",
      },
    ],
    isLoading: false,
    error: null,
    resumePending: false,
    refetch: vi.fn(),
    resumeExecution: vi.fn(),
  }),
}));

function renderDrawer(ui: ReactElement, initialEntries?: string[]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

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
  attachments: [],
};

const execution: AgentExecution = {
  agentKind: "codex",
  error: null,
  goal: null,
  issueIdentifier: "MAC-1",
  lastEvent: "turn.completed",
  lastEventAt: "2026-05-31T00:02:00Z",
  lastMessage: "Ready",
  longRunning: false,
  longRunningKind: null,
  longRunningLabel: null,
  retryAttempt: 0,
  runtimeSeconds: 42,
  sessionId: "session-1",
  executionSessionId: null,
  startedAt: "2026-05-31T00:01:00Z",
  status: "live",
  tokens: null,
  turnCount: 1,
};

describe("IssueDrawer sessions tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists execution and chat sessions without inline panels", () => {
    renderDrawer(
      <IssueDrawer
        issue={issue}
        projectSlug="macro-markets"
        view="list"
        execution={execution}
        open
        onOpenChange={() => {}}
        tab="sessions"
      />,
    );

    expect(screen.getByRole("tab", { name: /sessions/i })).toBeInTheDocument();
    expect(screen.getByText("Build pass 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open autonomous run MAC-1/i })).toBeInTheDocument();
  });

  it("shows a pursuing goal indicator in the issue header", () => {
    renderDrawer(
      <IssueDrawer
        issue={issue}
        projectSlug="macro-markets"
        view="list"
        execution={{
          ...execution,
          goal: {
            kind: "goal",
            source: "native",
            objective: "Ship the issue",
            status: "active",
            capabilities: ["get", "edit", "pause", "resume", "clear"],
            tokenBudget: null,
            tokensUsed: null,
            timeUsedSeconds: null,
            updatedAt: null,
          },
          longRunning: true,
          longRunningKind: "goal",
          longRunningLabel: "Pursuing goal",
        }}
        open
        onOpenChange={() => {}}
        tab="summary"
      />,
    );

    expect(screen.getByText("Pursuing goal")).toBeInTheDocument();
  });
});
