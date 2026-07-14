import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueSessionSplitLayout } from "@/components/sessions/IssueSessionSplitLayout";
import {
  SessionEnvironmentDockContext,
  type SessionEnvironmentDockControls,
} from "@/components/sessions/sessionEnvironmentDockContext";
import {
  SessionPreviewDockContext,
  type SessionPreviewDockControls,
} from "@/components/sessions/sessionPreviewDockContext";
import {
  SessionTerminalDockContext,
  type SessionTerminalDockControls,
} from "@/components/sessions/sessionTerminalDockContext";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/510", reason: null },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
  }),
}));

function renderLayout(
  dock: SessionTerminalDockControls | null,
  previewDock: SessionPreviewDockControls | null = null,
  environmentDock: SessionEnvironmentDockControls | null = null,
) {
  return render(
    <MemoryRouter>
      <SessionTerminalDockContext.Provider value={dock}>
        <SessionPreviewDockContext.Provider value={previewDock}>
          <SessionEnvironmentDockContext.Provider value={environmentDock}>
            <IssueSessionSplitLayout
              projectSlug="macro-markets"
              issueIdentifier="510"
              view="board"
              headerStart={<p>Issue session</p>}
            >
              <div data-testid="session-content">Session body</div>
            </IssueSessionSplitLayout>
          </SessionEnvironmentDockContext.Provider>
        </SessionPreviewDockContext.Provider>
      </SessionTerminalDockContext.Provider>
    </MemoryRouter>,
  );
}

describe("IssueSessionSplitLayout", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("toggles the workspace terminal dock from the toolbar button", async () => {
    const user = userEvent.setup();
    const toggleTerminal = vi.fn();

    renderLayout({ openIssueIdentifier: null, toggleTerminal });

    expect(screen.getByTestId("session-content")).toBeInTheDocument();

    const terminalButton = screen.getByRole("button", { name: "Terminal for 510" });
    expect(terminalButton).toHaveAttribute("aria-pressed", "false");

    await user.click(terminalButton);

    expect(toggleTerminal).toHaveBeenCalledWith("510");
  });

  it("marks the terminal button as pressed when the dock is open for this issue", () => {
    renderLayout({ openIssueIdentifier: "510", toggleTerminal: vi.fn() });

    expect(screen.getByRole("button", { name: "Terminal for 510" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the terminal page link without a dock-aware workspace", () => {
    renderLayout(null);

    expect(screen.getByRole("link", { name: "Terminal for 510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/terminal",
    );
  });

  it("toggles the workspace preview dock from the toolbar button", async () => {
    const user = userEvent.setup();
    const togglePreview = vi.fn();

    renderLayout(null, { openIssueIdentifier: null, togglePreview });

    const previewButton = screen.getByRole("button", { name: "Preview for 510" });
    expect(previewButton).toHaveAttribute("aria-pressed", "false");

    await user.click(previewButton);

    expect(togglePreview).toHaveBeenCalledWith("510");
  });

  it("marks the preview button as pressed when the dock is open for this issue", () => {
    renderLayout(null, { openIssueIdentifier: "510", togglePreview: vi.fn() });

    expect(screen.getByRole("button", { name: "Preview for 510" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the preview control without a preview-dock-aware workspace", () => {
    renderLayout(null);

    expect(screen.queryByRole("button", { name: "Preview for 510" })).not.toBeInTheDocument();
  });

  it("toggles the workspace environment dock from the toolbar button", async () => {
    const user = userEvent.setup();
    const toggleEnvironment = vi.fn();

    renderLayout(null, null, { openIssueIdentifier: null, toggleEnvironment });

    const environmentButton = screen.getByRole("button", { name: "Environment for 510" });
    expect(environmentButton).toHaveAttribute("aria-pressed", "false");

    await user.click(environmentButton);

    expect(toggleEnvironment).toHaveBeenCalledWith("510");
  });

  it("marks the environment button as pressed when the dock is open for this issue", () => {
    renderLayout(null, null, { openIssueIdentifier: "510", toggleEnvironment: vi.fn() });

    expect(screen.getByRole("button", { name: "Environment for 510" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides the environment control without an environment-dock-aware workspace", () => {
    renderLayout(null);

    expect(screen.queryByRole("button", { name: "Environment for 510" })).not.toBeInTheDocument();
  });
});
