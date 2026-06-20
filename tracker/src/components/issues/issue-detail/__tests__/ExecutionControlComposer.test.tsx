import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

const uploadAssistantAttachmentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
  uploadAssistantAttachment: (...args: unknown[]) => uploadAssistantAttachmentMock(...args),
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

const interruptedExecution = makeExecution({
  status: "idle",
  lastEvent: "turn_aborted",
  lastMessage: "Agent run interrupted — resume from the session log",
  turnCount: 0,
  runtimeSeconds: null,
  error: "Agent run interrupted — use Resume in the execution panel",
});

describe("ExecutionControlComposer", () => {
  beforeEach(() => {
    dispatchIssueAgentMock.mockReset();
    uploadAssistantAttachmentMock.mockReset();
    fetchAssistantCatalogBundleMock.mockResolvedValue({
      agents: [
        {
          agent: "codex",
          agentLabel: "Codex",
          command: "codex",
          models: [{ id: "gpt-5", model: "gpt-5", label: "GPT-5" }],
          efforts: [{ id: "high", label: "High" }],
        },
      ],
    });
  });

  it("steers a live run with /infer", () => {
    const onSteer = vi.fn();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live" })}
        sessionConnected
        canSteer
        onSteer={onSteer}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/focus on the failing test/i), {
      target: { value: "/infer prefer the simpler fix" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^steer$/i }));

    expect(onSteer).toHaveBeenCalledWith({
      message: "prefer the simpler fix",
      attachments: [],
    });
  });

  it("resumes a stalled run", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "resume",
      message: "Resuming agent work on CDE-1132",
      issue,
    });

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={interruptedExecution}
        sessionConnected
        onSteer={vi.fn()}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          goal: null,
          instructions: null,
        }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalledWith(issue);
  });

  it("enables resume when the run was interrupted but reported as idle", () => {
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={interruptedExecution}
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^resume$/i })).not.toBeDisabled();
  });

  it("sends typed guidance as instructions on resume", async () => {
    dispatchIssueAgentMock.mockResolvedValue({
      action: "resume",
      message: "Resuming agent work on CDE-1132",
      issue,
    });

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={interruptedExecution}
        onSteer={vi.fn()}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/optional guidance, then resume/i),
      "double-check the migration",
    );
    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          instructions: "double-check the migration",
        }),
      ),
    );
  });

  it("offers Start and no Pause when there is no run", () => {
    render(<ExecutionControlComposer projectSlug="advising" issue={issue} onSteer={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
  });

  it("queues guidance for a busy, non-steerable run", async () => {
    const onSteer = vi.fn();
    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "idle" })}
        onSteer={onSteer}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/queue for the next resume/i),
      "rebase before continuing",
    );
    await user.click(screen.getByRole("button", { name: /^queue$/i }));

    expect(screen.getByText("rebase before continuing")).toBeInTheDocument();
    expect(onSteer).not.toHaveBeenCalled();
    expect(dispatchIssueAgentMock).not.toHaveBeenCalled();
  });

  it("removes queued guidance", async () => {
    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "idle" })}
        onSteer={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText(/queue for the next resume/i), "queued note");
    await user.click(screen.getByRole("button", { name: /^queue$/i }));
    expect(screen.getByText("queued note")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove queued guidance/i }));
    expect(screen.queryByText("queued note")).not.toBeInTheDocument();
  });

  it("pauses an active run", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "stop",
      message: "Paused agent run for CDE-1132",
      issue,
    });

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live" })}
        onSteer={vi.fn()}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    const pauseButton = screen.getByRole("button", { name: /^pause$/i });
    expect(pauseButton).not.toBeDisabled();

    await user.click(pauseButton);

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ action: "stop" }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalledWith(issue);
  });

  it("hard resets the session after confirmation", async () => {
    const onIssueUpdated = vi.fn();
    dispatchIssueAgentMock.mockResolvedValue({
      action: "hard_reset",
      message: "Hard reset session for CDE-1132",
      issue,
    });

    const user = userEvent.setup();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live", lastEvent: "turn_completed", turnCount: 4 })}
        onSteer={vi.fn()}
        onIssueUpdated={onIssueUpdated}
      />,
    );

    const hardResetTrigger = screen.getByRole("button", { name: /hard reset/i });
    expect(hardResetTrigger).not.toBeDisabled();

    await user.click(hardResetTrigger);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^hard reset$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ action: "hard_reset" }),
      ),
    );
    expect(onIssueUpdated).toHaveBeenCalledWith(issue);
  });

  it("steers with pasted image attachments", async () => {
    uploadAssistantAttachmentMock.mockResolvedValue({
      type: "image",
      name: "shot.png",
      mediaType: "image/png",
      path: "uploads/shot.png",
    });

    const onSteer = vi.fn();
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live" })}
        sessionConnected
        canSteer
        onSteer={onSteer}
      />,
    );

    const textarea = screen.getByPlaceholderText(/focus on the failing test/i);
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        files: [file],
      },
    });

    await waitFor(() => expect(screen.getByRole("img", { name: "shot.png" })).toBeInTheDocument());

    fireEvent.change(textarea, { target: { value: "/infer check this screenshot" } });
    fireEvent.click(screen.getByRole("button", { name: /^steer$/i }));

    expect(onSteer).toHaveBeenCalledWith({
      message: "check this screenshot",
      attachments: [
        expect.objectContaining({ type: "image", name: "shot.png", path: "uploads/shot.png" }),
      ],
    });
  });

  it("shows a friendly steer error when no turn is steerable", () => {
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live" })}
        sessionConnected
        canSteer
        steerError="ActiveTurnNotSteerable"
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getByText(/use resume to pick the run back up/i)).toBeInTheDocument();
  });
});
