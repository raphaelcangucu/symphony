import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Keyboard } from "react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";
import type { AssistantCatalog } from "@/api/contracts";

import { AssistantChatScreen } from "./AssistantChatScreen";
import type { SessionTimelineState } from "./session-reducer";

const timeline: SessionTimelineState = {
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "Build the chat",
      toolCalls: [],
      insertedAt: "2026-07-26T02:00:00Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "History restored",
      toolCalls: [],
      insertedAt: "2026-07-26T02:00:01Z",
    },
  ],
  streamingText: "Live response",
  activeTools: [
    {
      id: "tool-1",
      name: "exec_command",
      status: "running",
      output: null,
    },
  ],
  connectionState: "live",
  pendingApproval: null,
  pendingUserInput: null,
  turnStatus: { status: "running", canResume: false, queuedMessages: [] },
  turnPreferences: { executionMode: null, skillProfile: null, model: null, effort: null },
  metadata: {
    projectSlug: null,
    agentKind: null,
    requestedModel: null,
    requestedEffort: null,
    resolvedModel: null,
    resolvedEffort: null,
  },
  error: null,
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof AssistantChatScreen>> = {}) {
  const props: React.ComponentProps<typeof AssistantChatScreen> = {
    title: "Studio Alpha",
    threadId: 42,
    timeline,
    onApproval: jest.fn().mockResolvedValue(undefined),
    onBack: jest.fn(),
    onOpenTerminal: jest.fn(),
    onResumeTurn: jest.fn().mockResolvedValue(undefined),
    onSend: jest.fn().mockResolvedValue(undefined),
    onStopTurn: jest.fn().mockResolvedValue(undefined),
    onSubmitUserInput: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    ...render(
      <ThemeProvider colorScheme="dark">
        <AssistantChatScreen {...props} />
      </ThemeProvider>,
    ),
    props,
  };
}

describe("AssistantChatScreen", () => {
  it("renders restored history, real-time streaming, grouped tools and terminal action", () => {
    renderScreen();

    expect(screen.getByText("Studio Alpha")).toBeTruthy();
    expect(screen.getByText("History restored")).toBeTruthy();
    expect(screen.getByText("Live response")).toBeTruthy();
    expect(screen.getByText("1 comando")).toBeTruthy();
    expect(screen.queryByText("exec_command")).toBeNull();
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("matches the web message hierarchy: user bubble, clean assistant reply and compact activity", () => {
    renderScreen({
      timeline: {
        ...timeline,
        activeTools: [],
        messages: [
          ...timeline.messages,
          {
            id: "system-1",
            role: "system",
            content:
              "System instructions\n\nA long internal prompt that must not dominate the conversation.",
            toolCalls: [],
            insertedAt: "2026-07-26T02:00:02Z",
          },
        ],
        streamingText: "",
      },
    });

    expect(screen.getByTestId("chat-message-user").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ alignSelf: "flex-end" })]),
    );
    expect(screen.getAllByTestId("chat-message-assistant")[0]?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alignSelf: "stretch", backgroundColor: "transparent" }),
      ]),
    );
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.queryByText("Dev10x")).toBeNull();
    expect(screen.getByText("System instructions")).toBeTruthy();
    expect(
      screen.queryByText("A long internal prompt that must not dominate the conversation."),
    ).toBeNull();
  });

  it("reveals compact system and tool details only on request", () => {
    renderScreen({
      timeline: {
        ...timeline,
        activeTools: [],
        messages: [
          {
            id: "system-1",
            role: "system",
            content: "Session started\n\nWorkspace /tmp/dev10x",
            toolCalls: [],
            insertedAt: null,
          },
          {
            id: "tool-message",
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool-complete",
                name: "exec_command",
                status: "complete",
                output: "command output",
              },
            ],
            insertedAt: null,
          },
        ],
        streamingText: "",
      },
    });

    expect(screen.queryByText("Workspace /tmp/dev10x")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Show Session started details" }));
    expect(screen.getByText("Workspace /tmp/dev10x")).toBeTruthy();

    expect(screen.queryByText("command output")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Show 1 activity details" }));
    fireEvent.press(screen.getByRole("button", { name: "Show exec_command details" }));
    expect(screen.getByText("command output")).toBeTruthy();
  });

  it("marks a completed turn as completed instead of leaving the session Live", () => {
    renderScreen({
      timeline: {
        ...timeline,
        streamingText: "",
        activeTools: [],
        turnStatus: { status: "completed", canResume: false, queuedMessages: [] },
      },
    });

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("shows the Host-resolved model and effort in the compact composer", () => {
    renderScreen({
      timeline: {
        ...timeline,
        metadata: {
          ...timeline.metadata,
          agentKind: "codex",
          resolvedModel: "gpt-5.6-sol",
          resolvedEffort: "low",
        },
      },
    });

    expect(screen.getByText("5.6 Sol Baixo")).toBeTruthy();
    expect(screen.queryByText("Model")).toBeNull();
    expect(screen.queryByText("Full access")).toBeNull();
  });

  it("chooses the effort after choosing a model that supports it", async () => {
    const onSetTurnPreferences = jest.fn().mockResolvedValue(undefined);
    const catalog: AssistantCatalog = {
      defaultAgent: "codex",
      agents: [
        {
          agent: "codex",
          agentLabel: "Codex CLI",
          defaultModel: "gpt-5.6-sol",
          models: [
            {
              model: "gpt-5.6-sol",
              label: "GPT-5.6-Sol",
              efforts: [
                { effort: "low", label: "Low" },
                { effort: "high", label: "High" },
              ],
            },
          ],
        },
      ],
    };

    renderScreen({
      catalog,
      catalogStatus: "ready",
      onSetTurnPreferences,
      timeline: {
        ...timeline,
        metadata: { ...timeline.metadata, agentKind: "codex" },
      },
    });

    fireEvent.press(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.press(screen.getByRole("button", { name: "Use GPT-5.6-Sol" }));
    expect(screen.getByText("GPT-5.6-Sol effort")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Use GPT-5.6-Sol with High effort" }));

    await waitFor(() =>
      expect(onSetTurnPreferences).toHaveBeenCalledWith({
        model: "gpt-5.6-sol",
        effort: "high",
      }),
    );
  });

  it("uses the web reasoning disclosure for orchestrator reasoning entries", () => {
    renderScreen({
      timeline: {
        ...timeline,
        activeTools: [],
        messages: [
          {
            id: "reasoning-1",
            role: "system",
            content: "Reasoning\n\nInternal chain summary",
            toolCalls: [],
            insertedAt: null,
          },
        ],
        streamingText: "",
      },
    });

    expect(screen.getAllByText("Reasoning")).toHaveLength(2);
    expect(screen.queryByText("Internal chain summary")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Show Reasoning details" }));
    expect(screen.getByText("Internal chain summary")).toBeTruthy();
  });

  it("sends a composer message through the Symphony session runtime", async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    renderScreen({ onSend });

    fireEvent.changeText(screen.getByLabelText("Message"), "Steer this session");
    await waitFor(() =>
      expect(screen.getByLabelText("Message").props.value).toBe("Steer this session"),
    );
    fireEvent.press(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Steer this session", []));
  });

  it("opens quick actions from plus and enables Plan mode without changing the draft", async () => {
    const onSetTurnPreferences = jest.fn().mockResolvedValue(undefined);
    renderScreen({ onSetTurnPreferences });

    fireEvent.changeText(screen.getByLabelText("Message"), "Keep this draft");
    fireEvent.press(screen.getByRole("button", { name: "Open composer actions" }));
    fireEvent.press(screen.getByRole("button", { name: "Plan mode" }));

    await waitFor(() =>
      expect(onSetTurnPreferences).toHaveBeenCalledWith({ executionMode: "plan" }),
    );
    expect(screen.getByLabelText("Message").props.value).toBe("Keep this draft");
    expect(screen.queryByText("Add to session")).toBeNull();
  });

  it("loads and runs a real Magic template", async () => {
    const template = {
      id: "7",
      slug: "review",
      name: "Review changes",
      description: "Find regressions and risks",
      category: "Quality",
      body: "Review",
      agentKind: "codex",
      model: null,
      effort: null,
      mode: "plan",
    };
    const onLoadMagic = jest.fn().mockResolvedValue([template]);
    const onRunMagic = jest.fn().mockResolvedValue(undefined);
    renderScreen({ onLoadMagic, onRunMagic });

    fireEvent.press(screen.getByRole("button", { name: "Open composer actions" }));
    fireEvent.press(screen.getByRole("button", { name: "Magic" }));

    expect(await screen.findByText("Review changes")).toBeTruthy();
    expect(screen.getByLabelText("Search magic")).toBeTruthy();
    expect(screen.getByText("Quality")).toBeTruthy();
    expect(screen.getByText("Codex · Plan")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Run Review changes" }));
    await waitFor(() => expect(onRunMagic).toHaveBeenCalledWith(template));
  });

  it("adds a typed context reference without replacing the draft", async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
    const onSearchContext = jest.fn().mockResolvedValue([
      { type: "issue", id: "VIN-3", label: "Mobile task details" },
      { type: "file", id: "mobile/app.tsx" },
      { type: "pr", id: "42", label: "Improve mobile task flow" },
    ]);
    const onSend = jest.fn().mockResolvedValue(undefined);
    renderScreen({ onSearchContext, onSend });

    fireEvent.changeText(screen.getByLabelText("Message"), "Review");
    fireEvent.press(screen.getByRole("button", { name: "Open composer actions" }));
    fireEvent.press(screen.getByRole("button", { name: "Add context" }));
    fireEvent.changeText(screen.getByLabelText("Search context"), "VIN");

    expect(await screen.findByText("Mobile task details")).toBeTruthy();
    expect(screen.getByText("Issues")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("Pull requests")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Add issue VIN-3" }));
    expect(screen.getByLabelText("Message").props.value).toBe("Review");
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Remove issue VIN-3" })).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("Review", [{ type: "issue", id: "VIN-3" }]),
    );
  });

  it("opens the terminal for the same host session", () => {
    const onOpenTerminal = jest.fn();
    renderScreen({ onOpenTerminal });

    fireEvent.press(screen.getByRole("button", { name: "Open terminal" }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it("keeps an associated task in the header without duplicating a task dock", () => {
    const onOpenTask = jest.fn();
    renderScreen({
      taskLinks: {
        identifier: "VIN-2",
        onOpenTask,
        onOpenEvidence: jest.fn(),
        onOpenPullRequest: jest.fn(),
      },
    });

    fireEvent.press(screen.getByRole("button", { name: "Open VIN-2 task" }));

    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Open task Evidence" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open task PRs" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Changes/ })).toBeNull();
  });

  it("opens Changes only when the Host reports source mutations", () => {
    const onOpenChanges = jest.fn();
    renderScreen({
      onOpenChanges,
      sourceChanges: { filesChanged: 3, additions: 137, deletions: 106 },
    });

    fireEvent.press(
      screen.getByRole("button", {
        name: "Open Changes: 3 files, 137 additions, 106 deletions",
      }),
    );

    expect(onOpenChanges).toHaveBeenCalledTimes(1);
  });

  it("keeps an active goal compact while showing its elapsed duration", () => {
    renderScreen({
      timeline: {
        ...timeline,
        goal: {
          enabled: true,
          available: true,
          status: "running",
          objective: "Ship the mobile evidence flow",
          source: "native",
          provider: "codex",
          capabilities: ["edit", "pause", "clear"],
          timeUsedSeconds: 1_463,
          running: true,
          resumable: false,
        },
      },
    });

    expect(screen.getByText("Pursuing goal")).toBeTruthy();
    expect(screen.getByText("Ship the mobile evidence flow")).toBeTruthy();
    expect(screen.getByText("24m 23s")).toBeTruthy();
  });

  it("shows the durable queued message directly above the goal and composer", () => {
    renderScreen({
      timeline: {
        ...timeline,
        turnStatus: {
          status: "running",
          canResume: false,
          queuedMessages: [
            { id: "queued-1", message: "After this, capture the E2E evidence", provider: "codex" },
            { id: "queued-2", message: "Then summarize the diff", provider: "codex" },
          ],
        },
      },
    });

    expect(screen.getByLabelText("Queued messages")).toBeTruthy();
    expect(screen.getByText("Queued message")).toBeTruthy();
    expect(screen.getByText("After this, capture the E2E evidence")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("does not show an idle stop control inside the composer", () => {
    renderScreen({
      timeline: {
        ...timeline,
        turnStatus: { status: "idle", canResume: false, queuedMessages: [] },
      },
    });

    expect(screen.queryByRole("button", { name: "Stop generation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop turn" })).toBeNull();
  });

  it("places dictated text in the same rich composer", async () => {
    renderScreen({
      onDictate: jest.fn().mockResolvedValue("Continue with the RPC"),
    });

    fireEvent.press(screen.getByRole("button", { name: "Dictate message" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Message").props.value).toBe("Continue with the RPC"),
    );
  });

  it("keeps chat dictation open until the user explicitly stops it", async () => {
    let finish: (value: string) => void = () => undefined;
    const result = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const stop = jest.fn(() => finish("A complete spoken message"));
    renderScreen({
      onStartDictation: jest.fn().mockResolvedValue({
        result,
        stop,
        cancel: jest.fn(),
      }),
    });

    fireEvent.press(screen.getByRole("button", { name: "Dictate message" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop dictation" })).toBeTruthy(),
    );
    fireEvent.press(screen.getByRole("button", { name: "Stop dictation" }));

    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Message").props.value).toBe("A complete spoken message");
    });
  });
});
