import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ExecutionChatPanel } from "@/components/issues/issue-detail/ExecutionChatPanel";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

vi.mock("@/hooks/useSessionLogChannel", () => ({
  useSessionLogChannel: () => ({
    channel: null,
    connected: true,
    entries: [],
    error: null,
    logAgentKind: null,
    preferredAgentKind: null,
    logFallback: false,
    steerTurn: vi.fn(),
    steerError: null,
    steerPending: false,
  }),
}));

vi.mock("@/components/issues/issue-detail/ExecutionControlComposer", () => ({
  ExecutionControlComposer: () => <div data-testid="execution-composer">composer</div>,
}));

vi.mock("@/components/issues/issue-detail/ReturnToAgentPanel", () => ({
  ReturnToAgentPanel: () => <div data-testid="return-panel">return</div>,
}));

const issue = {
  id: "1",
  identifier: "CDE-1132",
  title: "Custom fields",
  status: "Em andamento",
  priority: 0,
  assignee: null,
  projectSlug: "advising",
  blockedBy: [],
  labels: [],
  agentKind: "codex",
} as unknown as Issue;

function makeExecution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "CDE-1132",
    status: "live",
    agentKind: "codex",
    sessionId: "sess-1",
    lastEvent: "turn_started",
    lastMessage: "working",
    lastEventAt: null,
    turnCount: 2,
    runtimeSeconds: 120,
    startedAt: null,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ExecutionChatPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ExecutionChatPanel projectSlug="advising" issue={issue} {...props} />
    </MemoryRouter>,
  );
}

describe("ExecutionChatPanel", () => {
  it("renders the chat surface with transcript and composer", () => {
    renderPanel({ execution: makeExecution({ status: "live" }) });

    expect(screen.queryByText("Run status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Chat history for CDE-1132")).toBeInTheDocument();
    expect(screen.getByTestId("execution-composer")).toBeInTheDocument();
  });

  it("renders execution status when the parent toggle is open", () => {
    renderPanel({ execution: makeExecution({ status: "live" }), showExecutionStatus: true });

    expect(screen.getByText("Run status")).toBeInTheDocument();
  });

  it("keeps the composer inline (not behind advanced controls) outside a wait state", () => {
    renderPanel({ execution: makeExecution({ status: "live" }) });

    expect(screen.queryByText(/advanced controls/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-panel")).not.toBeInTheDocument();
  });

  it("still surfaces the composer when there is no execution yet", () => {
    renderPanel();

    expect(screen.queryByText("No active agent")).not.toBeInTheDocument();
    expect(screen.getByTestId("execution-composer")).toBeInTheDocument();
  });
});
