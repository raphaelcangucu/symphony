import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalWorkspacePanel } from "@/components/terminal/TerminalWorkspacePanel";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { openTerminalSession } from "@/services/terminal";
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

vi.mock("@/services/terminal", async () => {
  const actual = await vi.importActual<typeof import("@/services/terminal")>("@/services/terminal");
  return {
    ...actual,
    openTerminalSession: vi.fn(),
  };
});

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
  createTrackerSocket: () => ({
    connect: vi.fn(),
    channel,
    disconnect: vi.fn(),
  }),
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

describe("TerminalWorkspacePanel", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    vi.clearAllMocks();
    window.localStorage.clear();
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
    vi.mocked(openTerminalSession).mockResolvedValue({
      projectSlug: "demo",
      issueIdentifier: "DEMO-1",
      state: "running",
      sessionName: "sym-issue-demo-DEMO-1",
      cwd: "/tmp/demo",
      channelTopic: "terminal:demo:DEMO-1",
      message: null,
    });
    vi.mocked(listTerminalTabs).mockResolvedValue([]);
    vi.mocked(createTerminalTab).mockResolvedValue({
      id: "tab-abc",
      projectSlug: "demo",
      issueIdentifier: "DEMO-1",
      title: "Shell",
      cwd: "/tmp/demo",
      command: null,
      state: "running",
      sessionName: "sym-tab-demo-tab-abc",
      channelTopic: "terminal:tab:demo:tab-abc",
    });
  });

  it("renders issue and project terminal tabs", async () => {
    renderWithI18n(<TerminalWorkspacePanel projectSlug="demo" issueIdentifier="DEMO-1" />);

    await waitFor(() => expect(listTerminalTabs).toHaveBeenCalledWith("demo", "DEMO-1"));
    expect(screen.getByRole("tab", { name: /Issue/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
  });

  it("renders a thread terminal and joins the thread topic without issue APIs", async () => {
    renderWithI18n(<TerminalWorkspacePanel projectSlug="demo" threadId={8076} />);

    await waitFor(() =>
      expect(channel).toHaveBeenCalledWith("terminal:thread:8076", {
        project_slug: "demo",
      }),
    );

    expect(screen.getByRole("tab", { name: /Workspace/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New tab" })).not.toBeInTheDocument();
    expect(openTerminalSession).not.toHaveBeenCalled();
    expect(listTerminalTabs).not.toHaveBeenCalled();
  });

  it("joins the project devenv channel when the project tab is selected", async () => {
    renderWithI18n(<TerminalWorkspacePanel projectSlug="demo" issueIdentifier="DEMO-1" />);

    await waitFor(() => expect(listTerminalTabs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("tab", { name: /Project/i }));

    await waitFor(() =>
      expect(channel).toHaveBeenCalledWith("terminal:devenv:demo", {}),
    );
  });

  it("creates a dynamic terminal tab", async () => {
    renderWithI18n(<TerminalWorkspacePanel projectSlug="demo" issueIdentifier="DEMO-1" />);

    await waitFor(() => expect(listTerminalTabs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    await waitFor(() =>
      expect(createTerminalTab).toHaveBeenCalledWith("demo", "DEMO-1", { title: "Shell" }),
    );
    expect(screen.getByRole("tab", { name: /Shell/i })).toBeInTheDocument();
  });
});
