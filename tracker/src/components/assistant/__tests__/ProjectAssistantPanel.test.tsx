import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";

const channelHandlers: Record<string, (payload: unknown) => void> = {};
type ReceiveCallbacks = Record<string, (response: unknown) => void>;
const pushReceives: ReceiveCallbacks[] = [];
const push = vi.fn((_event: string, _payload?: unknown) => {
  const callbacks: ReceiveCallbacks = {};
  const result = {
    receive: (status: string, callback: (response: unknown) => void) => {
      callbacks[status] = callback;
      return result;
    },
  };
  pushReceives.push(callbacks);
  return result;
});
const join = vi.fn(() => ({ receive: (status: string, callback: (response: unknown) => void) => (status === "ok" ? callback({}) : undefined) }));
const leave = vi.fn(() => ({ receive: vi.fn() }));
const channel = {
  on: (event: string, callback: (payload: unknown) => void) => {
    channelHandlers[event] = callback;
  },
  join,
  leave,
  push,
};
const connect = vi.fn();
const disconnect = vi.fn();
const socketChannel = vi.fn(() => channel);

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExternalStoreRuntime: () => ({}),
}));

vi.mock("@/services/assistant", async () => {
  const actual = await vi.importActual<typeof import("@/services/assistant")>("@/services/assistant");
  const mockCodexCatalog = {
    agent: "codex" as const,
    agentLabel: "Codex CLI",
    command: "codex app-server",
    defaultModel: "gpt-5.3-codex",
    models: [
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        label: "GPT-5.3 Codex",
        isDefault: true,
        defaultEffort: "low",
        efforts: [{ id: "low", label: "Low" }],
      },
    ],
  };
  return {
    ...actual,
    fetchAssistantCatalogBundle: vi.fn(async () => ({
      agents: [mockCodexCatalog],
      defaultAgent: "codex" as const,
    })),
    fetchAssistantCodexCatalog: vi.fn(async () => mockCodexCatalog),
  };
});

vi.mock("@/services/phoenix/socket", () => ({
  createTrackerSocket: () => ({
    connect,
    disconnect,
    channel: socketChannel,
  }),
}));

describe("ProjectAssistantPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
    pushReceives.length = 0;
  });

  it("renders a routed project assistant page, loads history, streams a response, and sends through the channel", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    expect(screen.getByRole("region", { name: "Project assistant" })).toBeTruthy();
    expect(socketChannel).toHaveBeenCalledWith("assistant:macro-markets");

    channelHandlers["history_loaded"]({
      messages: [{ id: 1, role: "assistant", content: "Historico carregado", tool_calls: [] }],
    });

    expect(await screen.findByText("Historico carregado")).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Oi" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({
          message: "Oi",
          context: expect.objectContaining({
            view: "board",
            agent: "codex",
            model: expect.any(String),
            effort: expect.any(String),
          }),
          attachments: expect.any(Array),
        }),
      ),
    );

    channelHandlers["message_created"]({ message: { id: 2, role: "user", content: "Oi", tool_calls: [] } });
    channelHandlers["assistant_delta"]({ delta: "Olá" });
    channelHandlers["assistant_delta"]({ delta: ", posso ajudar." });
    channelHandlers["assistant_completed"]({
      message: {
        id: 3,
        role: "assistant",
        content: "Olá, posso ajudar.",
        tool_calls: [{ name: "list_issues", status: "complete", result: { issues: [] } }],
      },
    });

    expect(await screen.findByText("Oi")).toBeTruthy();
    expect(await screen.findByText("Olá, posso ajudar.")).toBeTruthy();
    expect(screen.getByText("List issues")).toBeTruthy();
  });

  it("queues a message submitted while running and auto-sends it on completion", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "first" })),
    );
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "second" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("second")).toBeTruthy();
    expect(push).not.toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" }));

    channelHandlers["assistant_completed"]({ message: { id: 9, role: "assistant", content: "done", tool_calls: [] } });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" })),
    );
  });

  it("removes a queued message when its chip remove button is clicked", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "queued one" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    const removeButton = await screen.findByRole("button", { name: /remove queued message/i });
    fireEvent.click(removeButton);

    await waitFor(() => expect(screen.queryByText("queued one")).toBeNull());
  });

  it("force-sends a queued message via steer when its send button is clicked", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "send me now" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    const sendNow = await screen.findByRole("button", { name: /send queued message now/i });
    fireEvent.click(sendNow);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("steer_turn", expect.objectContaining({ message: "send me now" })),
    );
    await waitFor(() => expect(screen.queryByText("send me now")).toBeNull());
  });

  it("steers a running turn when /infer is submitted, and falls back to queue on steer_failed", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "do work" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "do work" })),
    );
    channelHandlers["assistant_delta"]({ delta: "..." });

    fireEvent.change(textarea, { target: { value: "/infer prefer the simpler fix" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("steer_turn", expect.objectContaining({ message: "prefer the simpler fix" })),
    );

    channelHandlers["steer_failed"]({ reason: "ActiveTurnNotSteerable", message: "prefer the simpler fix" });
    expect(await screen.findByText("prefer the simpler fix")).toBeTruthy();
  });

  it("runs an authoring goal in the chat and shows its banner when /goal is submitted", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "/goal ship the feature" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("set_goal_mode", { goal_mode: true, objective: "ship the feature" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({ message: expect.stringContaining("ship the feature") }),
      ),
    );
    // The framed instruction is authoring-only: it explicitly tells Codex NOT to dispatch the
    // orchestrator and to run the goal directly in the conversation.
    const goalSend = push.mock.calls.find(
      ([event, payload]) =>
        event === "send_message" &&
        typeof (payload as { message?: string })?.message === "string" &&
        (payload as { message: string }).message.includes("ship the feature"),
    );
    const goalSendMessage = (goalSend?.[1] as { message: string }).message;
    expect(goalSendMessage).toMatch(/authoring goal/i);
    expect(goalSendMessage).toMatch(/do not dispatch the orchestrator/i);

    // Resolving the set_goal_mode push surfaces the Authoring goal banner.
    const goalCallIndex = push.mock.calls.findIndex(([event]) => event === "set_goal_mode");
    pushReceives[goalCallIndex]?.ok?.({ goal_mode: true, goal_objective: "ship the feature" });

    const banner = await screen.findByRole("status", { name: "Authoring goal" });
    expect(banner).toHaveTextContent("ship the feature");
  });

  it("rehydrates the authoring goal banner from the join response", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok"
          ? callback({ goal_mode: true, goal_objective: "Audit the auth module", thread_id: 1 })
          : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    const banner = await screen.findByRole("status", { name: "Authoring goal" });
    expect(banner).toHaveTextContent("Audit the auth module");
  });

  it("shows a Resume button when the last turn was interrupted and pushes resume_turn on click", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok"
          ? callback({ messages: [], thread_id: 1, last_turn: { status: "interrupted", can_resume: true } })
          : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const button = await screen.findByRole("button", { name: /resume/i });
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith("resume_turn", {});
  });

  it("requests native goal status on join and shows pause while a goal is running", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Channel asks for the native goal after join.
    expect(push).toHaveBeenCalledWith("goal_status", {});

    // Native goal is active and a turn is streaming → the pill shows Pause + timer.
    channelHandlers["goal_status"]({
      enabled: true,
      objective: "Audit",
      native: true,
      goal: { kind: "goal", source: "native", status: "active", timeUsedSeconds: 42 },
      running: true,
    });
    channelHandlers["goal_running"]({ running: true });

    const pause = await screen.findByRole("button", { name: "Pause goal" });
    const pill = screen.getByRole("status", { name: "Authoring goal" });
    expect(pill.textContent ?? "").toMatch(/\d+s/);

    fireEvent.click(pause);
    expect(push).toHaveBeenCalledWith("goal_pause", {});
  });

  it("resumes a stalled native goal from the pill", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Native goal exists and is active but no turn is streaming → stalled, offer Resume.
    channelHandlers["goal_status"]({
      enabled: true,
      objective: "Audit",
      native: true,
      goal: { kind: "goal", source: "native", status: "active", timeUsedSeconds: 10 },
      running: false,
    });

    const resume = await screen.findByRole("button", { name: "Resume goal" });
    fireEvent.click(resume);
    expect(push).toHaveBeenCalledWith("goal_resume", {});
  });

  it("removes and edits the authoring goal objective from the pill", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Edit: open inline editor, change the objective, save.
    fireEvent.click(await screen.findByRole("button", { name: "Edit objective" }));
    const editor = await screen.findByPlaceholderText("Describe the authoring objective…");
    fireEvent.change(editor, { target: { value: "Audit the admin UI" } });
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    expect(push).toHaveBeenCalledWith("goal_set_objective", { objective: "Audit the admin UI" });

    // Remove: clears the goal entirely.
    fireEvent.click(await screen.findByRole("button", { name: "Remove goal" }));
    expect(push).toHaveBeenCalledWith("goal_clear", {});
  });

  it("opens an overlay and streams the answer when /btw is submitted", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "/btw what is useMemo" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("btw", expect.objectContaining({ message: "what is useMemo" })),
    );

    const btwCallIndex = push.mock.calls.findIndex(([event]) => event === "btw");
    pushReceives[btwCallIndex]?.ok?.({ btw_id: "btw-1" });

    channelHandlers["btw_delta"]({ btw_id: "btw-1", delta: "useMemo memoizes" });
    expect(await screen.findByText(/useMemo memoizes/)).toBeTruthy();

    channelHandlers["btw_completed"]({ btw_id: "btw-1", message: "useMemo memoizes a value." });
    expect(await screen.findByText("useMemo memoizes a value.")).toBeTruthy();
  });

  it("joins an issue-scoped assistant topic when an issue identifier is provided", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    expect(socketChannel).toHaveBeenCalledWith("assistant:issue:macro-markets:MAC-1");
  });

  it("reports a created draft issue when the completed assistant message includes create_draft_issue", async () => {
    const onDraftIssueCreated = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onDraftIssueCreated={onDraftIssueCreated}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 7,
        role: "assistant",
        content: "Drafted MAC-7.",
        tool_calls: [
          {
            name: "create_draft_issue",
            status: "complete",
            result: {
              tool: "create_draft_issue",
              message: "Created draft MAC-7",
              data: { id: 7, identifier: "MAC-7", title: "Draft issue" },
            },
          },
        ],
      },
    });

    expect(onDraftIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-7" });
  });

  it("reports issue-created events from the channel", async () => {
    const onIssueCreated = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onIssueCreated={onIssueCreated}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_issue_created"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_issue_created"]({ identifier: "MAC-8", thread_id: 88 });

    expect(onIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-8", threadId: 88 });
  });

  it("sends set_mode through the existing issue channel when issue mode changes", async () => {
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="triage"
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith("set_mode", expect.anything());

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="complex"
      />,
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("set_mode", { mode: "complex" }));
    expect(socketChannel).toHaveBeenCalledTimes(1);
  });

  it("rehydrates the persisted issue mode from the join response", async () => {
    const onIssueModeChanged = vi.fn();
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ mode: "complex", thread_id: 1 }) : undefined,
    }));

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="triage"
        onIssueModeChanged={onIssueModeChanged}
      />,
    );

    await waitFor(() => expect(onIssueModeChanged).toHaveBeenCalledWith("complex"));
    expect(push).not.toHaveBeenCalledWith("set_mode", expect.anything());
  });

  it("does not rehydrate when the persisted mode is triage", async () => {
    const onIssueModeChanged = vi.fn();
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ mode: "triage", thread_id: 1 }) : undefined,
    }));

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="triage"
        onIssueModeChanged={onIssueModeChanged}
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(onIssueModeChanged).not.toHaveBeenCalled();
  });

  it("allows retrying the same set_mode value after an error", async () => {
    const onIssueModeError = vi.fn();
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="complex"
        issueModeRequestId={1}
        onIssueModeError={onIssueModeError}
      />,
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("set_mode", { mode: "complex" }));
    const firstSetModeCallIndex = push.mock.calls.findIndex(([event]) => event === "set_mode");
    pushReceives[firstSetModeCallIndex]?.error?.({ reason: "temporary failure" });
    expect(onIssueModeError).toHaveBeenCalledWith("temporary failure");

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueMode="complex"
        issueModeRequestId={2}
        onIssueModeError={onIssueModeError}
      />,
    );

    await waitFor(() => expect(push.mock.calls.filter(([event]) => event === "set_mode")).toHaveLength(2));
  });

  it("sends set_goal_mode through the issue channel when goal mode is enabled", async () => {
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={false}
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith("set_goal_mode", expect.anything());

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
      />,
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("set_goal_mode", { goal_mode: true }));
  });

  it("rehydrates an enabled goal mode from the join response", async () => {
    const onIssueGoalModeChanged = vi.fn();
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, thread_id: 1 }) : undefined,
    }));

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={false}
        onIssueGoalModeChanged={onIssueGoalModeChanged}
      />,
    );

    await waitFor(() => expect(onIssueGoalModeChanged).toHaveBeenCalledWith(true));
  });

  it("pushes dispatch_coding_agent with the current goal mode when dispatch is requested", async () => {
    const onDispatchSucceeded = vi.fn();
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
        dispatchRequestId={0}
        onDispatchSucceeded={onDispatchSucceeded}
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith("dispatch_coding_agent", expect.anything());

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
        dispatchRequestId={1}
        onDispatchSucceeded={onDispatchSucceeded}
      />,
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("dispatch_coding_agent", expect.objectContaining({ goal_mode: true })),
    );

    const dispatchCallIndex = push.mock.calls.findIndex(([event]) => event === "dispatch_coding_agent");
    pushReceives[dispatchCallIndex]?.ok?.({ message: "Requested Codex work on MAC-1" });
    expect(onDispatchSucceeded).toHaveBeenCalledWith("Requested Codex work on MAC-1");
  });

  it("renders an embedded assistant without viewport height", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="embedded" />);

    const region = screen.getByRole("region", { name: "Project assistant" });
    expect(region).toHaveClass("h-full");
    expect(region).not.toHaveClass("h-[calc(100vh-4rem)]");
    expect(region).not.toHaveClass("h-screen");
    expect(socketChannel).toHaveBeenCalledWith("assistant:issue:macro-markets:MAC-1");
  });

  it("renders a nested issue assistant page without viewport height", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    const region = screen.getByRole("region", { name: "Project assistant" });
    expect(region).toHaveClass("h-full");
    expect(region).not.toHaveClass("h-[calc(100vh-4rem)]");
  });

  it("keeps thread id topic priority over issue identifier", () => {
    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        threadId={42}
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
      />,
    );

    expect(socketChannel).toHaveBeenCalledWith("assistant:thread:42");
  });

  it("surfaces assistant document change events from the channel", async () => {
    const onDocumentChanged = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onDocumentChanged={onDocumentChanged}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_document_changed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_document_changed"]({ identifier: "MAC-1" });

    expect(onDocumentChanged).toHaveBeenCalledWith({ identifier: "MAC-1" });
  });

  it("does not reconnect the channel when onDocumentChanged identity changes", async () => {
    const onDocumentChanged = vi.fn();

    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="embedded"
        onDocumentChanged={onDocumentChanged}
      />,
    );

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));

    const leaveCallsBefore = leave.mock.calls.length;

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="embedded"
        onDocumentChanged={vi.fn()}
      />,
    );

    expect(leave).toHaveBeenCalledTimes(leaveCallsBefore);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("renders file-edit tool calls as a file-activity card and keeps other tools generic", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 42,
        role: "assistant",
        content: "Done.",
        tool_calls: [
          { name: "apply_patch", status: "complete", result: { paths: ["lib/foo.ex"], additions: 12, deletions: 3, diff: "@@\n+a" } },
          { name: "list_issues", status: "complete", result: { issues: [] } },
        ],
      },
    });

    expect(await screen.findByText("lib/foo.ex")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    // Non-file tool call still uses the generic block.
    expect(screen.getByText("List issues")).toBeInTheDocument();
  });

  it("replaces the transcript when history_synced arrives after a terminal turn_status", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["history_synced"]).toEqual(expect.any(Function)));

    channelHandlers["history_loaded"]({
      messages: [{ id: 1, role: "user", content: "go", tool_calls: [] }],
    });

    channelHandlers["turn_status"]({ status: "completed" });

    await waitFor(() => expect(push).toHaveBeenCalledWith("sync_history", {}));

    channelHandlers["history_synced"]({
      messages: [
        { id: 1, role: "user", content: "go", tool_calls: [] },
        { id: 2, role: "assistant", content: "done without refresh", tool_calls: [] },
      ],
    });

    expect(await screen.findByText("done without refresh")).toBeInTheDocument();
  });

  it("does not auto-scroll when the user has scrolled away from the bottom", async () => {
    render(
      <ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="embedded" />,
    );

    await waitFor(() => expect(channelHandlers["history_loaded"]).toEqual(expect.any(Function)));

    await act(async () => {
      channelHandlers["history_loaded"]({
        messages: [
          { id: 1, role: "user", content: "hello", tool_calls: [] },
          { id: 2, role: "assistant", content: "initial reply", tool_calls: [] },
        ],
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scroller = screen.getByText("initial reply").closest(".overflow-y-auto") as HTMLDivElement;
    const scrollTo = vi.spyOn(scroller, "scrollTo").mockImplementation(() => undefined);

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 0;

    await act(async () => {
      fireEvent.scroll(scroller);
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    });

    scrollTo.mockClear();

    await act(async () => {
      channelHandlers["history_synced"]({
        messages: [
          { id: 1, role: "user", content: "hello", tool_calls: [] },
          { id: 2, role: "assistant", content: "reconciled reply", tool_calls: [] },
        ],
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.getByText("reconciled reply")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);
  });
});
