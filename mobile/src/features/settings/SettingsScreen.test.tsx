import { fireEvent, render, screen } from "@testing-library/react-native";

import type { AgentAvailabilityMap, AgentUsageMap } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { SettingsScreen } from "./SettingsScreen";

const availability: AgentAvailabilityMap = {
  codex: {
    available: true,
    version: "1.2.3",
    command: "codex",
    path: "/usr/bin/codex",
    authenticated: true,
    detail: null,
  },
};
const usage: AgentUsageMap = {
  codex: {
    agentKind: "codex",
    plan: "pro",
    creditsRemaining: null,
    creditsUnlimited: true,
    fetchedAt: "2026-07-24T01:00:00Z",
    stale: false,
    windows: [
      {
        kind: "five_hour",
        usedPercent: 42,
        resetsAt: "2026-07-24T05:00:00Z",
        windowMinutes: 300,
      },
    ],
    modelLimits: [],
  },
};

describe("SettingsScreen", () => {
  it("shows availability, usage, and routes to operational settings", () => {
    const onOpenDiagnostics = jest.fn();
    const onOpenNotifications = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <SettingsScreen
          availability={availability}
          error={null}
          loading={false}
          onBack={jest.fn()}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenNotifications={onOpenNotifications}
          onRefresh={jest.fn()}
          usage={usage}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Available · 1.2.3")).toBeTruthy();
    expect(screen.getByText("42% used")).toBeTruthy();
    expect(screen.getByText("System appearance")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open notifications" }));
    fireEvent.press(screen.getByRole("button", { name: "Open diagnostics" }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("explains unavailable server capabilities", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <SettingsScreen
          availability={{}}
          error="Usage is unsupported by this server"
          loading={false}
          onBack={jest.fn()}
          onOpenDiagnostics={jest.fn()}
          onOpenNotifications={jest.fn()}
          onRefresh={jest.fn()}
          usage={{}}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText("Usage is unsupported by this server")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry settings" })).toBeTruthy();
  });
});
