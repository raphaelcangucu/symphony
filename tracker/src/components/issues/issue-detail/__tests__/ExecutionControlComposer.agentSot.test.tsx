import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";

const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());
const updateIssueMock = vi.hoisted(() => vi.fn());
const updateAssistantThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: vi.fn(),
}));

vi.mock("@/services/goalControl", () => ({
  controlIssueGoal: vi.fn(),
}));

vi.mock("@/components/commands/useMagicCommands", () => ({
  useMagicCommands: () => ({ commands: [], isLoading: false, error: null, isRunning: false, run: vi.fn() }),
}));

vi.mock("@/hooks/useAssistantCommands", () => ({
  useAssistantCommands: () => ({ commands: [], isLoading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
  uploadAssistantAttachment: vi.fn(),
}));

vi.mock("@/services/issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/issues")>()),
  listIssues: vi.fn().mockResolvedValue([]),
  updateIssue: (...args: unknown[]) => updateIssueMock(...args),
}));

vi.mock("@/services/assistantThreads", () => ({
  updateAssistantThread: (...args: unknown[]) => updateAssistantThreadMock(...args),
}));

vi.mock("@/services/workspaceFiles", () => ({
  searchWorkspaceFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pullRequests")>()),
  listPullRequests: vi.fn().mockResolvedValue({ data: [], supported: false, available: false }),
}));

vi.mock("@/components/assistant/AssistantComposer", () => ({
  AssistantComposer: ({
    onAgentChange,
  }: {
    onAgentChange?: (agent: AgentKind) => void;
  }) => (
    <button type="button" onClick={() => onAgentChange?.("cursor")}>
      Change agent to cursor
    </button>
  ),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: () => null,
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
    status: "idle",
    agentKind: "codex",
    sessionId: "sess-1",
    executionSessionId: null,
    lastEvent: "turn_aborted",
    lastMessage: "interrupted",
    lastEventAt: null,
    turnCount: 1,
    runtimeSeconds: null,
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

describe("ExecutionControlComposer agent source-of-truth", () => {
  beforeEach(() => {
    updateIssueMock.mockReset();
    updateIssueMock.mockResolvedValue(issue);
    updateAssistantThreadMock.mockReset();
    updateAssistantThreadMock.mockResolvedValue({ id: 9001, agentKind: "cursor" });
    fetchAssistantCatalogBundleMock.mockResolvedValue({
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
        {
          agent: "cursor",
          agentLabel: "Cursor",
          command: "cursor",
          defaultModel: "composer-1",
          models: [
            {
              id: "composer-1",
              model: "composer-1",
              label: "Composer 1",
              defaultEffort: "low",
              efforts: [{ id: "low", label: "Low" }],
            },
          ],
        },
      ],
    });
  });

  it("patches thread agent_kind when changing agent on a session-backed execution", async () => {
    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ executionSessionId: 9001 })}
        onSteer={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: /change agent to cursor/i }),
    );

    await waitFor(() => {
      expect(updateAssistantThreadMock).toHaveBeenCalledWith(9001, { agentKind: "cursor" });
    });
    await waitFor(() => {
      expect(updateIssueMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ agent: "cursor" }),
      );
    });
  });

  it("does not patch thread agent_kind when execution has no session id", async () => {
    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ executionSessionId: null })}
        onSteer={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: /change agent to cursor/i }),
    );

    await waitFor(() => {
      expect(updateIssueMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ agent: "cursor" }),
      );
    });
    expect(updateAssistantThreadMock).not.toHaveBeenCalled();
  });
});
