import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTerminalWorkspace } from "@/components/terminal/ProjectTerminalWorkspace";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { PROJECT_TERMINAL_SCOPE } from "@/lib/terminalScopes";
import { createTerminalTab, listTerminalTabs } from "@/services/terminalTabs";

const channelHandlers: Record<string, (payload: unknown) => void> = {};
const push = vi.fn();
const channel = vi.fn(() => ({
  on: vi.fn((event: string, callback: (payload: unknown) => void) => {
    channelHandlers[event] = callback;
  }),
  join: vi.fn(() => ({
    receive: vi.fn(function receive(this: unknown) {
      return this;
    }),
  })),
  push,
  leave: vi.fn(),
}));

vi.mock("@/services/terminalTabs", async () => {
  const actual = await vi.importActual<typeof import("@/services/terminalTabs")>("@/services/terminalTabs");
  return {
    ...actual,
    listTerminalTabs: vi.fn(),
    createTerminalTab: vi.fn(),
    closeTerminalTab: vi.fn(),
  };
});

vi.mock("@/services/phoenix/socket", () => ({
  createTrackerSocket: vi.fn(() => ({
    connect: vi.fn(),
    channel,
    disconnect: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function Terminal() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      reset: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      cols: 80,
      rows: 24,
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function FitAddon() {
    return { fit: vi.fn() };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

describe("ProjectTerminalWorkspace", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(listTerminalTabs).mockResolvedValue([]);
    vi.mocked(createTerminalTab).mockResolvedValue({
      id: "tab-abc",
      projectSlug: "demo",
      issueIdentifier: PROJECT_TERMINAL_SCOPE,
      title: "Shell",
      cwd: "/tmp/demo",
      command: null,
      state: "running",
      sessionName: "sym-tab-demo-tab-abc",
      channelTopic: "terminal:tab:demo:tab-abc",
    });
  });

  it("renders the project terminal tab", async () => {
    renderWithI18n(<ProjectTerminalWorkspace projectSlug="demo" />);

    expect(screen.getByRole("heading", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Project/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(listTerminalTabs).toHaveBeenCalledWith("demo", PROJECT_TERMINAL_SCOPE),
    );
  });

  it("joins the project devenv channel for the default tab", async () => {
    renderWithI18n(<ProjectTerminalWorkspace projectSlug="demo" />);

    await waitFor(() => expect(listTerminalTabs).toHaveBeenCalled());
    await waitFor(() => expect(channel).toHaveBeenCalledWith("terminal:devenv:demo", {}));
  });

  it("creates a project-scoped dynamic terminal tab", async () => {
    renderWithI18n(<ProjectTerminalWorkspace projectSlug="demo" />);

    await waitFor(() => expect(listTerminalTabs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /New tab/i }));

    await waitFor(() =>
      expect(createTerminalTab).toHaveBeenCalledWith("demo", PROJECT_TERMINAL_SCOPE, { title: "Shell" }),
    );
  });
});
