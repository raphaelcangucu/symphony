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
  pendingApproval: null,
  pendingUserInput: null,
  turnStatus: { status: "running", canResume: false, queuedMessages: [] },
  turnPreferences: { executionMode: null, skillProfile: null, model: null, effort: null },
  metadata: { projectSlug: null, agentKind: null, requestedModel: null, requestedEffort: null, resolvedModel: null, resolvedEffort: null },
  error: null,
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof SessionScreen>> = {}) {
  const props: React.ComponentProps<typeof SessionScreen> = {
    threadId: 42,
    timeline,
    onBack: jest.fn(),
    onDictate: jest.fn().mockResolvedValue(""),
    onSend: jest.fn().mockResolvedValue(undefined),
    onApproval: jest.fn().mockResolvedValue(undefined),
    onResumeTurn: jest.fn().mockResolvedValue(undefined),
    onStopTurn: jest.fn().mockResolvedValue(undefined),
    onSubmitUserInput: jest.fn().mockResolvedValue(undefined),
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

  it("appends dictated text to a pending follow-up", async () => {
    renderScreen({ onDictate: jest.fn().mockResolvedValue("and spoken words") });

    fireEvent.changeText(screen.getByLabelText("Message"), "Keep draft");
    fireEvent.press(screen.getByRole("button", { name: "Dictate message" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Message")).toHaveProp("value", "Keep draft and spoken words"),
    );
  });

  it("renders and resolves approval and question cards", async () => {
    const onApproval = jest.fn().mockResolvedValue(undefined);
    const onSubmitUserInput = jest.fn().mockResolvedValue(undefined);
    renderScreen({
      timeline: {
        ...timeline,
        pendingApproval: {
          requestId: "approval-1",
          command: "git push",
          cwd: "/work/symphony",
          reason: "Publish the branch",
          toolName: "exec",
          agent: "codex",
        },
        pendingUserInput: {
          requestId: "question-1",
          questions: [
            {
              id: "target",
              header: "Target",
              question: "Where should this deploy?",
              isOther: false,
              isSecret: false,
              options: [{ label: "Production", description: "Public app" }],
            },
          ],
        },
      },
      onApproval,
      onSubmitUserInput,
    });

    expect(screen.getByText("Approval required")).toBeTruthy();
    expect(screen.getByText("git push")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Approve command" }));
    await waitFor(() => expect(onApproval).toHaveBeenCalledWith("approval-1", "approve"));

    expect(screen.getByText("Where should this deploy?")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Select Production" }));
    fireEvent.press(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() =>
      expect(onSubmitUserInput).toHaveBeenCalledWith("question-1", {
        target: "Production",
      }),
    );
  });

  it("stops running turns and resumes interrupted turns", async () => {
    const onStopTurn = jest.fn().mockResolvedValue(undefined);
    const onResumeTurn = jest.fn().mockResolvedValue(undefined);
    const view = renderScreen({ onStopTurn, onResumeTurn });

    fireEvent.press(screen.getByRole("button", { name: "Stop turn" }));
    expect(onStopTurn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop turn" })).toBeEnabled());

    view.rerender(
      <ThemeProvider colorScheme="dark">
        <SessionScreen
          onApproval={jest.fn()}
          onBack={jest.fn()}
          onResumeTurn={onResumeTurn}
          onSend={jest.fn()}
          onStopTurn={onStopTurn}
          onSubmitUserInput={jest.fn()}
          threadId={42}
          timeline={{
            ...timeline,
            turnStatus: { status: "interrupted", canResume: true, queuedMessages: [] },
          }}
        />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByRole("button", { name: "Resume turn" }));
    await waitFor(() => expect(onResumeTurn).toHaveBeenCalledTimes(1));
  });
});
