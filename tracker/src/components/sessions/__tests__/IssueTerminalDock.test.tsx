import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueTerminalDock } from "@/components/sessions/IssueTerminalDock";
import { initTestI18n } from "@/i18n/testUtils";
import * as floatingSurfaceStore from "@/stores/floatingSurfaceStore";

vi.mock("@/components/terminal/TerminalWorkspacePanel", () => ({
  TerminalWorkspacePanel: ({ trailingActions }: { trailingActions?: React.ReactNode }) => (
    <div data-testid="terminal-panel">{trailingActions}</div>
  ),
}));

function renderDock({
  fullscreen = false,
  onToggleFullscreen = () => {},
  onClose = () => {},
}: {
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onClose?: () => void;
} = {}) {
  const splitContainerRef = createRef<HTMLDivElement>();

  return render(
    <div ref={splitContainerRef} style={{ width: 1200 }}>
      <IssueTerminalDock
        projectSlug="macro-markets"
        issueIdentifier="510"
        splitContainerRef={splitContainerRef}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />
    </div>,
  );
}

describe("IssueTerminalDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    window.localStorage.clear();
  });

  it("renders resize, fullscreen, popout and close controls in split mode", () => {
    renderDock();

    expect(screen.getByRole("button", { name: "Resize terminal panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand terminal to full screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in floating window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close terminal panel" })).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
  });

  it("hides the resize handle in full screen mode", () => {
    renderDock({ fullscreen: true });

    expect(screen.queryByRole("button", { name: "Resize terminal panel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
  });

  it("invokes close and fullscreen callbacks", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onToggleFullscreen = vi.fn();

    renderDock({ onClose, onToggleFullscreen });

    await user.click(screen.getByRole("button", { name: "Expand terminal to full screen" }));
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close terminal panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exits full screen with Escape", async () => {
    const user = userEvent.setup();
    const onToggleFullscreen = vi.fn();

    renderDock({ fullscreen: true, onToggleFullscreen });

    await user.keyboard("{Escape}");

    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("opens a floating surface popout for the issue terminal", async () => {
    const user = userEvent.setup();
    const openSpy = vi
      .spyOn(floatingSurfaceStore, "openFloatingSurfaceOrToast")
      .mockReturnValue("issue-terminal:macro-markets:510");

    renderDock();

    await user.click(screen.getByRole("button", { name: "Open in floating window" }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "issue-terminal",
        projectSlug: "macro-markets",
        issueIdentifier: "510",
        title: "Terminal · 510",
      }),
      expect.any(String),
    );
  });
});
