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
  TerminalView: ({
    ariaLabel,
    serverSlug,
    kind,
    enabled,
  }: {
    ariaLabel: string;
    serverSlug?: string;
    kind: string;
    enabled?: boolean;
  }) => (
    <div
      data-testid="interactive-terminal"
      data-kind={kind}
      data-server-slug={serverSlug}
      data-enabled={enabled ? "true" : "false"}
      aria-label={ariaLabel}
    />
  ),
}));

describe("DevServerOutputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subscribeDevServerOutput).mockReturnValue(() => undefined);
    floatingSurfaceStore.resetFloatingSurfaceStoreForTests();
  });

  it("shows load error without empty pre body when there is no interactive session", async () => {
    vi.mocked(fetchDevServerOutput).mockRejectedValue(new Error("fail"));

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="crashed"
        sessionName={null}
        defaultOpen
      />,
    );

    expect(await screen.findByText(/could not load server output/i)).toBeInTheDocument();
    expect(screen.queryByText(/no output captured/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/front command output/i)).not.toBeInTheDocument();
  });

  it("streams output for stalled servers without an interactive session", () => {
    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="stalled"
        sessionName={null}
        defaultOpen
      />,
    );

    expect(subscribeDevServerOutput).toHaveBeenCalledWith("macro-markets", "510", 1, expect.any(Object));
  });

  it("renders the interactive terminal inline when a session exists", () => {
    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="crashed"
        sessionName="sym-dev-front"
        defaultOpen
      />,
    );

    const terminal = screen.getByTestId("interactive-terminal");
    expect(terminal).toHaveAttribute("data-kind", "dev-server");
    expect(terminal).toHaveAttribute("data-server-slug", "front");
    expect(terminal).toHaveAttribute("data-enabled", "true");
    expect(fetchDevServerOutput).not.toHaveBeenCalled();
    expect(subscribeDevServerOutput).not.toHaveBeenCalled();
  });

  it("offers run-again on failed servers and forwards the action", async () => {
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

    const terminals = await screen.findAllByTestId("interactive-terminal");
    expect(terminals.length).toBeGreaterThanOrEqual(1);
    expect(terminals.some((node) => node.getAttribute("data-enabled") === "true")).toBe(true);
    expect(screen.getByText(/interactive terminal/i)).toBeInTheDocument();
  });

  it("opens a floating surface popout for the server output", async () => {
    const openSpy = vi
      .spyOn(floatingSurfaceStore, "openFloatingSurfaceOrToast")
      .mockReturnValue("dev-server-output:macro-markets:510:1");

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
