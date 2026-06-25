import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  AgentTab: () => <div data-testid="agent-execution-panel">Execution</div>,
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
  groupLeadIdentifier: null,
  groupMemberIdentifiers: [],
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
