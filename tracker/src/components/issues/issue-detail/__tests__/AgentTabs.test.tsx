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

vi.mock("@/components/issues/issue-detail/AgentTab", () => ({
  AgentTab: ({ showExecutionStatus }: { showExecutionStatus?: boolean }) => (
    <div data-testid="agent-execution-panel">
      Execution {showExecutionStatus ? "status-open" : "status-closed"}
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
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByTestId("agent-execution-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-authoring-panel")).not.toBeInTheDocument();
  });

  it("toggles execution status from the execution hint row", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" execution={execution} />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/watch the live run/i)).not.toBeInTheDocument();
    const statusToggle = screen.getByRole("button", { name: /run status/i });
    expect(screen.getByTestId("agent-tabs-left-control")).toContainElement(statusToggle);
    expect(statusToggle).toHaveAttribute("aria-expanded", "false");
    expect(statusToggle).toHaveTextContent("Live");
    expect(screen.getByTestId("agent-execution-panel")).toHaveTextContent("status-closed");

    await user.click(statusToggle);

    expect(statusToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("agent-execution-panel")).toHaveTextContent("status-open");
  });

  it("shows the resolved execution status in the status toggle", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs
          issue={issue}
          projectSlug="distributionmachine"
          view="board"
          execution={{
            ...execution,
            status: "idle",
            lastEvent: "turn_aborted",
            error: "Run interrupted",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /run status/i })).toHaveTextContent("Aborted");
  });

  it("does not show the execution status toggle while authoring", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=authoring"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" execution={execution} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: /run status/i })).not.toBeInTheDocument();
  });

  it("hides the view-issue link and code button without issueHref", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" />
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
