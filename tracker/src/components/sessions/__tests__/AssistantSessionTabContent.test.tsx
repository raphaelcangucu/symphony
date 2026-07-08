import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/hooks/useWorkspaceDiffStats", () => ({
  useWorkspaceDiffStats: () => ({ additions: 12, deletions: 3 }),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: ({ diffRequestId }: { diffRequestId?: number }) => (
    <div data-testid="assistant-panel" data-diff-request-id={diffRequestId ?? 0} />
  ),
}));

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/510", reason: null },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
  }),
}));

const listAssistantThreadsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: (...args: unknown[]) => listAssistantThreadsMock(...args),
}));

describe("AssistantSessionTabContent", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    listAssistantThreadsMock.mockReset();
    listAssistantThreadsMock.mockResolvedValue([
      {
        id: 7996,
        scope: "issue_session",
        agentKind: "codex",
        projectSlug: "macro-markets",
        projectName: "Macro Markets",
        issueIdentifier: "510",
        title: "Build pass",
        status: "active",
        preview: null,
        updatedAt: "2026-07-07T00:00:00Z",
      },
    ]);
  });

  it("shows issue working-tree actions for issue-bound assistant sessions", async () => {
    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Open issue 510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/sessions",
    );
    expect(screen.getByRole("button", { name: "Terminal for 510" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /open in code/i })).toBeInTheDocument();
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
  });

  it("toggles the workspace terminal dock instead of navigating to the issue drawer", async () => {
    const user = userEvent.setup();
    const toggleTerminal = vi.fn();

    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Terminal for 510" }));

    expect(toggleTerminal).toHaveBeenCalledWith("510");
  });

  it("shows diff line counters next to the toolbar diff button", async () => {
    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("+12")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("opens the composer's diff modal from the toolbar diff button", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("assistant-panel")).toHaveAttribute("data-diff-request-id", "0");

    await user.click(screen.getByRole("button", { name: "Diff" }));
    expect(screen.getByTestId("assistant-panel")).toHaveAttribute("data-diff-request-id", "1");

    await user.click(screen.getByRole("button", { name: "Diff" }));
    expect(screen.getByTestId("assistant-panel")).toHaveAttribute("data-diff-request-id", "2");
  });
});
