import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueTerminal, ProjectTerminal } from "@/components/terminal/IssueTerminal";
import { openTerminalSession } from "@/services/terminal";

const channelHandlers: Record<string, (payload: unknown) => void> = {};
const push = vi.fn();
const leave = vi.fn();
const disconnect = vi.fn();
const connect = vi.fn();
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
  leave,
}));

const write = vi.fn();
const reset = vi.fn();
const dispose = vi.fn();
const onData = vi.fn();
const onResize = vi.fn();
const loadAddon = vi.fn();
const open = vi.fn();
const fit = vi.fn();

vi.mock("@/services/terminal", async () => {
  const actual = await vi.importActual<typeof import("@/services/terminal")>("@/services/terminal");
  return {
    ...actual,
    openTerminalSession: vi.fn(),
  };
});

vi.mock("@/services/phoenix/socket", () => ({
  createTrackerSocket: () => ({
    connect,
    channel,
    disconnect,
  }),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function Terminal() {
    return {
      loadAddon,
      open,
      onData,
      onResize,
      reset,
      write,
      dispose,
      cols: 80,
      rows: 24,
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function FitAddon() {
    return { fit };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "issue.terminal.ariaLabel") return `Terminal for ${params?.identifier ?? ""}`;
      if (key === "issue.terminal.projectAriaLabel") return `Project terminal for ${params?.projectSlug ?? ""}`;
      return key;
    },
  }),
}));

describe("IssueTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
    vi.mocked(openTerminalSession).mockResolvedValue({
      projectSlug: "macro-markets",
      issueIdentifier: "MAC-1",
      state: "running",
      sessionName: "sym-issue-MAC-1",
      cwd: "/tmp/symphony-workspaces/MAC-1",
      channelTopic: "terminal:macro-markets:MAC-1",
      message: null,
    });
  });

  it("opens a terminal session and writes channel output into xterm", async () => {
    render(<IssueTerminal projectSlug="macro-markets" issueIdentifier="MAC-1" />);

    await waitFor(() => expect(openTerminalSession).toHaveBeenCalledWith("macro-markets", "MAC-1"));
    expect(channel).toHaveBeenCalledWith("terminal:macro-markets:MAC-1", { project_slug: "macro-markets" });

    channelHandlers.output?.({ data: "hello\n" });

    expect(write).toHaveBeenCalledWith("hello\n");
    expect(screen.getByLabelText("Terminal for MAC-1")).toBeTruthy();
  });

  it("sends terminal input and resize events over the channel", async () => {
    render(<IssueTerminal projectSlug="macro-markets" issueIdentifier="MAC-1" />);

    await waitFor(() => expect(openTerminalSession).toHaveBeenCalled());

    onData.mock.calls[0]?.[0]("ls\n");
    onResize.mock.calls[0]?.[0]({ cols: 100, rows: 30 });

    expect(push).toHaveBeenCalledWith("input", { data: "ls\n" });
    expect(push).toHaveBeenCalledWith("resize", { cols: 100, rows: 30 });
  });

  it("opens a project terminal session through the project channel", async () => {
    render(<ProjectTerminal projectSlug="macro-markets" />);

    expect(openTerminalSession).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(channel).toHaveBeenCalledWith("terminal:devenv:macro-markets", {}),
    );
    expect(screen.getByLabelText("Project terminal for macro-markets")).toBeTruthy();
  });
});
