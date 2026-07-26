import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { OrchestratorExecutionsScreen } from "./OrchestratorExecutionsScreen";

const execution = {
  issueIdentifier: "DEV-10",
  executionSessionId: 77,
  status: "live" as const,
  agentKind: "codex" as const,
  model: null,
  lastMessage: "Implementing the mobile RPC",
  lastEventAt: "2026-07-26T08:00:00Z",
  turnCount: 2,
};

describe("OrchestratorExecutionsScreen", () => {
  it("shows real host executions with their default agent model", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <OrchestratorExecutionsScreen
          connectionState="live"
          error={null}
          executions={[execution]}
          onBack={jest.fn()}
          onOpen={jest.fn()}
          onRetry={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("DEV-10")).toBeTruthy();
    expect(screen.getByText("Codex · Default model")).toBeTruthy();
    expect(screen.getByText("Implementing the mobile RPC")).toBeTruthy();
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
  });

  it("opens the selected execution transcript", () => {
    const onOpen = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <OrchestratorExecutionsScreen
          connectionState="live"
          error={null}
          executions={[execution]}
          onBack={jest.fn()}
          onOpen={onOpen}
          onRetry={jest.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.press(
      screen.getByRole("button", { name: "Open DEV-10 Codex execution" }),
    );
    expect(onOpen).toHaveBeenCalledWith(execution);
  });
});
