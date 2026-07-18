import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDevServerOutput, subscribeDevServerOutput } from "@/services/issueDevServers";
import * as floatingSurfaceStore from "@/stores/floatingSurfaceStore";

import { DevServerOutputPanel } from "../DevServerOutputPanel";

vi.mock("@/services/issueDevServers", () => ({
  fetchDevServerOutput: vi.fn(),
  subscribeDevServerOutput: vi.fn(),
}));

vi.mock("@/components/terminal/TerminalView", () => ({
  TerminalView: ({ ariaLabel, serverSlug, kind }: { ariaLabel: string; serverSlug?: string; kind: string }) => (
    <div data-testid="interactive-terminal" data-kind={kind} data-server-slug={serverSlug} aria-label={ariaLabel} />
  ),
}));

describe("DevServerOutputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subscribeDevServerOutput).mockReturnValue(() => undefined);
  });

  it("shows load error without empty pre body", async () => {
    vi.mocked(fetchDevServerOutput).mockRejectedValue(new Error("fail"));

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="crashed"
        sessionName="sym"
        defaultOpen
      />,
    );

    expect(await screen.findByText(/could not load server output/i)).toBeInTheDocument();
    expect(screen.queryByText(/no output captured/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/front command output/i)).not.toBeInTheDocument();
  });

  it("streams output for stalled servers", () => {
    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="stalled"
        sessionName="sym"
        defaultOpen
      />,
    );

    expect(subscribeDevServerOutput).toHaveBeenCalledWith("macro-markets", "510", 1, expect.any(Object));
  });

  it("offers run-again on failed servers and forwards the action", async () => {
    vi.mocked(fetchDevServerOutput).mockResolvedValue({ output: "boom", session_name: "sym" });
    const onRerun = vi.fn();

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="crashed"
        sessionName="sym"
        defaultOpen
        onRerun={onRerun}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /run again/i }));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it("does not offer run-again while starting", async () => {
    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="starting"
        sessionName="sym"
        defaultOpen
        onRerun={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /run again/i })).not.toBeInTheDocument();
  });

  it("opens the fullscreen dialog with an interactive terminal attached to the server session", async () => {
    vi.mocked(fetchDevServerOutput).mockResolvedValue({ output: "serve log line", session_name: "sym" });

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="stopped"
        sessionName="sym"
        defaultOpen
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open front output in fullscreen/i }));

    const terminal = await screen.findByTestId("interactive-terminal");
    expect(terminal).toHaveAttribute("data-kind", "dev-server");
    expect(terminal).toHaveAttribute("data-server-slug", "front");
    expect(screen.getByText(/interactive terminal/i)).toBeInTheDocument();
  });

  it("opens a floating surface popout for the server output", async () => {
    const openSpy = vi
      .spyOn(floatingSurfaceStore, "openFloatingSurfaceOrToast")
      .mockReturnValue("dev-server-output:macro-markets:510:1");

    vi.mocked(fetchDevServerOutput).mockResolvedValue({ output: "line", session_name: "sym" });

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="stopped"
        sessionName="sym"
        defaultOpen
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open front output in popout/i }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "dev-server-output",
        projectSlug: "macro-markets",
        issueIdentifier: "510",
        serverId: 1,
        serverSlug: "front",
      }),
      expect.any(String),
    );
  });
});
