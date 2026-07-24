import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { SessionScreen } from "./SessionScreen";
import type { SessionTimelineState } from "./session-reducer";

const timeline: SessionTimelineState = {
  messages: [
    {
      id: "1",
      role: "user",
      content: "Build it",
      toolCalls: [],
      insertedAt: "2026-07-24T02:00:00Z",
    },
    {
      id: "2",
      role: "assistant",
      content: "Working on it",
      toolCalls: [],
      insertedAt: "2026-07-24T02:01:00Z",
    },
  ],
  streamingText: "Running tests",
  activeTools: [
    {
      id: "tool-1",
      name: "run_tests",
      status: "running",
      output: null,
    },
  ],
  connectionState: "live",
  error: null,
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof SessionScreen>> = {}) {
  const props: React.ComponentProps<typeof SessionScreen> = {
    threadId: 42,
    timeline,
    onBack: jest.fn(),
    onSend: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <SessionScreen {...props} />
    </ThemeProvider>,
  );
}

describe("SessionScreen", () => {
  it("renders bottom-anchored history, streaming output, tools, and explicit socket state", () => {
    renderScreen();

    expect(screen.getByText("Session 42")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Build it")).toBeTruthy();
    expect(screen.getByText("Working on it")).toBeTruthy();
    expect(screen.getByText("Running tests")).toBeTruthy();
    expect(screen.getByText("run_tests")).toBeTruthy();
    expect(screen.getByTestId("session-message-list")).toHaveProp(
      "contentContainerStyle",
      expect.objectContaining({ flexGrow: 1, justifyContent: "flex-end" }),
    );
  });

  it("sends multiline follow-ups once and clears only after acceptance", async () => {
    const onSend = jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    renderScreen({ onSend });

    fireEvent.changeText(screen.getByLabelText("Message"), "Continue\ncarefully");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    fireEvent.press(screen.getByRole("button", { name: "Sending" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Message")).toHaveProp("value", "Continue\ncarefully");
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveProp("value", ""));
  });

  it("keeps the composer text when sending fails", async () => {
    renderScreen({ onSend: jest.fn().mockRejectedValue(new Error("Socket offline")) });

    fireEvent.changeText(screen.getByLabelText("Message"), "Do not lose this");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Socket offline/);
    expect(screen.getByLabelText("Message")).toHaveProp("value", "Do not lose this");
  });
});
