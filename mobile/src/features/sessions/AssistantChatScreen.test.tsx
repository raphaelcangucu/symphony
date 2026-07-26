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
