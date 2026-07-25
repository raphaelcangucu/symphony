import { fireEvent, render, screen } from "@testing-library/react-native";

import type { DiagnosticEntry } from "@/diagnostics/diagnostic-log";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { DiagnosticsScreen } from "./DiagnosticsScreen";

const entries: DiagnosticEntry[] = [
  {
    id: "1",
    at: "2026-07-24T01:00:00Z",
    scope: "request",
    event: "GET /viewer",
    details: { status: 200 },
  },
];

describe("DiagnosticsScreen", () => {
  it("shows redacted history and exposes recovery controls", () => {
    const onReconnect = jest.fn();
    const onClear = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <DiagnosticsScreen
          connectionState="offline"
          entries={entries}
          onBack={jest.fn()}
          onClear={onClear}
          onReconnect={onReconnect}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("GET /viewer")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Reconnect" }));
    fireEvent.press(screen.getByRole("button", { name: "Clear diagnostics" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
