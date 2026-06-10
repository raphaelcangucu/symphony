import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
