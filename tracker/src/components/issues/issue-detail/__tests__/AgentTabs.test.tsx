import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTabs } from "@/components/issues/issue-detail/AgentTabs";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const authoringRenderCount = vi.hoisted(() => ({ value: 0 }));

vi.mock("@/hooks/useIssueDocuments", () => ({
  useIssueDocuments: () => ({
    available: true,
    documents: [{ id: "spec", kind: "spec", path: "docs/spec.md", title: "Spec", updatedAt: null }],
    loading: false,
    reason: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/assistant/IssueAuthoringPanel", () => ({
  IssueAuthoringPanel: () => {
    authoringRenderCount.value += 1;
    return <div data-testid="issue-authoring-panel">Authoring ({authoringRenderCount.value})</div>;
  },
}));

vi.mock("@/components/assistant/ExecutionSessionPanel", () => ({
  ExecutionSessionPanel: ({ threadId }: { threadId: number }) => (
    <div data-testid="agent-execution-panel" data-thread={threadId}>
      Execution
    </div>
  ),
}));

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/?folder=/w", reason: null },
    cursorDesktop: { available: true, url: "cursor://file/w", reason: null },
    loading: false,
  }),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: vi.fn().mockResolvedValue({
    defaultAgent: "codex",
    agents: [
      {
        agent: "codex",
        agentLabel: "Codex",
        command: "codex",
        defaultModel: "gpt-5",
        models: [
          {
            id: "gpt-5",
            model: "gpt-5",
            label: "GPT-5",
            defaultEffort: "high",
            efforts: [{ id: "high", label: "High" }],
          },
        ],
      },
    ],
  }),
}));

const issue: Issue = {
  assignee: null,
  blockedBy: [],
  branchName: "feat/dis-6",
  createdAt: "2026-05-31T00:00:00Z",
  creator: "alice",
  description: "Test",
  id: "6",
  identifier: "DIS-6",
  labels: [],
  position: 1,
  priority: 2,
  projectSlug: "distributionmachine",
  status: "Todo",
  title: "Test issue",
  updatedAt: "2026-05-31T00:00:00Z",
  url: null,
  attachments: [],
};

const execution: AgentExecution = {
  issueIdentifier: "DIS-6",
  status: "live",
  agentKind: "codex",
  sessionId: "sess-1",
  executionSessionId: 9001,
  lastEvent: "turn_started",
  lastMessage: null,
  lastEventAt: null,
  turnCount: 2,
  runtimeSeconds: null,
  startedAt: null,
  retryAttempt: 0,
  error: null,
  goal: null,
  longRunning: true,
  longRunningKind: null,
  longRunningLabel: "Running",
  tokens: null,
};

describe("AgentTabs documents drawer", () => {
  beforeEach(() => {
    authoringRenderCount.value = 0;
  });

  it("shows documents on the execution section", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" execution={execution} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByTestId("agent-execution-panel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-execution-panel")).toHaveAttribute("data-thread", "9001");
    expect(screen.queryByTestId("issue-authoring-panel")).not.toBeInTheDocument();
  });

  it("shows an empty state with new-session when there is no execution session id", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs
          issue={issue}
          projectSlug="distributionmachine"
          view="board"
          execution={{ ...execution, executionSessionId: null }}
        />
      </MemoryRouter>,
    );

    const empty = screen.getByTestId("agent-execution-empty");
    expect(empty).toBeInTheDocument();
    expect(screen.queryByTestId("agent-execution-panel")).not.toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: /new session/i })).toBeInTheDocument();
  });

  it("hides the view-issue link and code button without issueHref", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" execution={execution} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /open issue DIS-6/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /terminal for DIS-6/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in code/i })).not.toBeInTheDocument();
  });

  it("opens the new session dialog from the quick action button", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/distributionmachine/board/issues/DIS-6/agent?agent=authoring"]}>
        <Routes>
          <Route
            path="/projects/distributionmachine/board/issues/DIS-6/agent"
            element={<AgentTabs issue={issue} projectSlug="distributionmachine" view="board" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /new session/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText(/DIS-6/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("execution-mode-icon-build")).toBeInTheDocument();
  });

  it("shows the view-issue, terminal, and code shortcuts when hrefs are provided", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs
          issue={issue}
          projectSlug="distributionmachine"
          view="board"
          execution={execution}
          issueHref="/projects/distributionmachine/board/issues/DIS-6"
          issueTerminalHref="/projects/distributionmachine/board/issues/DIS-6/terminal"
        />
      </MemoryRouter>,
    );

    const issueLink = screen.getByRole("link", { name: /open issue DIS-6/i });
    expect(issueLink).toHaveAttribute("href", "/projects/distributionmachine/board/issues/DIS-6");
    const terminalLink = screen.getByRole("link", { name: /terminal for DIS-6/i });
    expect(terminalLink).toHaveAttribute("href", "/projects/distributionmachine/board/issues/DIS-6/terminal");
    expect(screen.getByRole("button", { name: /open in code/i })).toBeInTheDocument();
  });

  it("does not re-render the authoring panel when only execution status changes", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=authoring"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" execution={execution} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("issue-authoring-panel")).toHaveTextContent("Authoring (1)");

    rerender(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=authoring"]}>
        <AgentTabs
          issue={issue}
          projectSlug="distributionmachine"
          view="board"
          execution={{ ...execution, lastEvent: "turn_completed", turnCount: 3 }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("issue-authoring-panel")).toHaveTextContent("Authoring (1)");
  });
});
