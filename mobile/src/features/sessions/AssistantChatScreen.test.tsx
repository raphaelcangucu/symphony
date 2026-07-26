import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

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
  turnStatus: { status: "running", canResume: false },
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
  it("renders restored history, real-time streaming, consolidated tools and terminal action", () => {
    renderScreen();

    expect(screen.getByText("Studio Alpha")).toBeTruthy();
    expect(screen.getByText("History restored")).toBeTruthy();
    expect(screen.getByText("Live response")).toBeTruthy();
    expect(screen.getByText("exec_command")).toBeTruthy();
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
    fireEvent.press(screen.getByRole("button", { name: "Show exec_command details" }));
    expect(screen.getByText("command output")).toBeTruthy();
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

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Steer this session"));
  });

  it("opens the terminal for the same host session", () => {
    const onOpenTerminal = jest.fn();
    renderScreen({ onOpenTerminal });

    fireEvent.press(screen.getByRole("button", { name: "Open terminal" }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not show an idle stop control inside the composer", () => {
    renderScreen({
      timeline: {
        ...timeline,
        turnStatus: { status: "idle", canResume: false },
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
});
