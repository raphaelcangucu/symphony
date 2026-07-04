import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import type { AssistantCommand } from "@/types/assistant-command";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());
const controlIssueGoalMock = vi.hoisted(() => vi.fn());
const useMagicCommandsMock = vi.hoisted(() => vi.fn());
const useAssistantCommandsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

vi.mock("@/services/goalControl", () => ({
  controlIssueGoal: (...args: unknown[]) => controlIssueGoalMock(...args),
}));

vi.mock("@/components/commands/useMagicCommands", () => ({
  useMagicCommands: (...args: unknown[]) => useMagicCommandsMock(...args),
}));

vi.mock("@/hooks/useAssistantCommands", () => ({
  useAssistantCommands: (...args: unknown[]) => useAssistantCommandsMock(...args),
}));

const uploadAssistantAttachmentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
  uploadAssistantAttachment: (...args: unknown[]) => uploadAssistantAttachmentMock(...args),
}));

const listIssuesMock = vi.hoisted(() => vi.fn());
const searchWorkspaceFilesMock = vi.hoisted(() => vi.fn());
const listPullRequestsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/issues")>()),
  listIssues: (...args: unknown[]) => listIssuesMock(...args),
}));

vi.mock("@/services/workspaceFiles", () => ({
  searchWorkspaceFiles: (...args: unknown[]) => searchWorkspaceFilesMock(...args),
}));

vi.mock("@/services/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pullRequests")>()),
  listPullRequests: (...args: unknown[]) => listPullRequestsMock(...args),
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
    controlIssueGoalMock.mockReset();
    uploadAssistantAttachmentMock.mockReset();
    listIssuesMock.mockReset();
    listIssuesMock.mockResolvedValue([]);
    searchWorkspaceFilesMock.mockReset();
    searchWorkspaceFilesMock.mockResolvedValue([]);
    listPullRequestsMock.mockReset();
    listPullRequestsMock.mockResolvedValue({ data: [], supported: false, available: false });
    fetchAssistantCatalogBundleMock.mockResolvedValue({
      agents: [
        {
          agent: "codex",
          agentLabel: "Codex",
          command: "codex",
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
    });
    useMagicCommandsMock.mockReturnValue({
      commands: [],
      isLoading: false,
      error: null,
      isRunning: false,
      run: vi.fn(),
    });
    useAssistantCommandsMock.mockReturnValue({
      commands: [],
      isLoading: false,
      error: null,
      reload: vi.fn(),
    });
  });

  it("shows API-provided slash command suggestions in execution composer", async () => {
    const commands: AssistantCommand[] = [
      {
        slug: "release",
        name: "Release",
        description: "Prepare and publish release",
        kind: "skill",
        category: "automation",
        submitKind: null,
        source: "skills-dir",
      },
    ];
    useAssistantCommandsMock.mockReturnValue({
      commands,
      isLoading: false,
      error: null,
      reload: vi.fn(),
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

    const textarea = screen.getByPlaceholderText(/optional guidance/i);
    await user.click(textarea);
    await user.type(textarea, "/rel");

    expect(await screen.findByText("/release")).toBeInTheDocument();
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

  it("steers a live run on a plain message, without requiring /infer", () => {
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
      target: { value: "focus on the migration path" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^steer$/i }));

    expect(onSteer).toHaveBeenCalledWith({
      message: "focus on the migration path",
      attachments: [],
    });
  });

  it("disables steer while the session channel is not connected", () => {
    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={makeExecution({ status: "live" })}
        canSteer
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^steer$/i })).toBeDisabled();
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

  it("forwards the selected model and effort on resume", async () => {
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

    // Let the remote catalog load so the composer resolves codex → gpt-5/high.
    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          model: "gpt-5",
          effort: "high",
        }),
      ),
    );
  });

  it("forwards the execution mode on resume (defaults to build)", async () => {
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

    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ action: "resume", mode: "build" }),
      ),
    );
  });

  it("cycles the execution mode with Shift+Tab and forwards it", async () => {
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

    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());

    // codex order is plan → build → yolo, so one Shift+Tab moves build → yolo.
    fireEvent.keyDown(screen.getByPlaceholderText(/optional guidance/i), {
      key: "Tab",
      shiftKey: true,
    });

    expect(screen.getByRole("button", { name: /yolo/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({ action: "resume", mode: "yolo" }),
      ),
    );
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

  it("opens the magic palette from the toolbar button", async () => {
    const user = userEvent.setup();
    render(<ExecutionControlComposer projectSlug="advising" issue={issue} onSteer={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^magic$/i }));

    expect(await screen.findByPlaceholderText(/search magic commands/i)).toBeInTheDocument();
  });

  it("toggles the magic palette with mod+p", async () => {
    render(<ExecutionControlComposer projectSlug="advising" issue={issue} onSteer={vi.fn()} />);

    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true });
    expect(await screen.findByPlaceholderText(/search magic commands/i)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search magic commands/i)).not.toBeInTheDocument();
    });
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

  it("sets an execution goal and dispatches when /goal is submitted", async () => {
    controlIssueGoalMock.mockResolvedValue({
      action: "set_objective",
      cleared: false,
      goal: { kind: "goal", source: "native", objective: "ship i18n", status: "pending", capabilities: [] },
    });
    dispatchIssueAgentMock.mockResolvedValue({
      action: "resume",
      message: "Resume requested",
      issue,
    });

    render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issue}
        execution={interruptedExecution}
        onSteer={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText(/optional guidance/i);
    fireEvent.change(textarea, { target: { value: "/goal ship i18n" } });
    fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() => {
      expect(controlIssueGoalMock).toHaveBeenCalledWith("advising", "CDE-1132", {
        action: "set_objective",
        objective: "ship i18n",
      });
    });

    // The goal is set natively via controlIssueGoal; the resume dispatch must NOT
    // re-send the objective (doing so would reset native goal accounting). The
    // objective only survives as framing in the resume instructions.
    await waitFor(() => {
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          goal: null,
          instructions: expect.stringContaining("ship i18n"),
        }),
      );
    });
  });

  it("@-mentions an issue and submits it as a context chip", async () => {
    listIssuesMock.mockResolvedValue([
      { id: "12", identifier: "DEMO-12", title: "Login bug", status: "Open" },
    ]);
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

    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());

    const textarea = screen.getByPlaceholderText(/optional guidance/i);
    await user.click(textarea);
    await user.type(textarea, "@DEMO");

    const option = await screen.findByText("DEMO-12");
    await user.click(option);

    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("Login bug")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^resume$/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith(
        "advising",
        "CDE-1132",
        expect.objectContaining({
          action: "resume",
          contextRefs: [
            expect.objectContaining({
              type: "issue",
              id: "DEMO-12",
              label: "Login bug",
              state: "draft",
            }),
          ],
        }),
      ),
    );
  });

  it("renders the goal pill from execution.goal only, not issue.agentGoal", () => {
    const issueWithCachedGoal = {
      ...issue,
      agentGoal: "stale cached objective",
    } as unknown as Issue;

    const { rerender } = render(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issueWithCachedGoal}
        execution={makeExecution({ goal: null })}
        onSteer={vi.fn()}
      />,
    );

    expect(screen.queryByText("stale cached objective")).not.toBeInTheDocument();

    rerender(
      <ExecutionControlComposer
        projectSlug="advising"
        issue={issueWithCachedGoal}
        execution={makeExecution({
          goal: {
            kind: "goal",
            source: "native",
            objective: "native objective",
            status: "active",
            capabilities: [],
          } as unknown as AgentExecution["goal"],
        })}
        onSteer={vi.fn()}
      />,
    );

    expect(screen.getByText("native objective")).toBeInTheDocument();
    expect(screen.queryByText("stale cached objective")).not.toBeInTheDocument();
  });
});
