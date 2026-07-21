import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { SessionEnvironmentDockContext } from "@/components/sessions/sessionEnvironmentDockContext";
import { SessionPreviewDockContext } from "@/components/sessions/sessionPreviewDockContext";
import { SessionTasksDockContext } from "@/components/sessions/sessionTasksDockContext";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/hooks/useWorkspaceDiffStats", () => ({
  useWorkspaceDiffStats: () => ({ additions: 12, deletions: 3 }),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: ({
    diffRequestId,
    executionMode,
    onKnowledgeBaseControlChange,
  }: {
    diffRequestId?: number;
    executionMode?: boolean;
    onKnowledgeBaseControlChange?: unknown;
  }) => (
    <div
      data-testid={executionMode ? "execution-session-panel" : "assistant-panel"}
      data-diff-request-id={diffRequestId ?? 0}
      data-execution-mode={executionMode ? "true" : "false"}
      data-has-kb-control={onKnowledgeBaseControlChange ? "true" : "false"}
    />
  ),
}));

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/510", reason: null },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
  }),
}));

const getAssistantThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  getAssistantThread: (...args: unknown[]) => getAssistantThreadMock(...args),
  listAssistantThreads: vi.fn(),
}));

describe("AssistantSessionTabContent", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    getAssistantThreadMock.mockReset();
    getAssistantThreadMock.mockResolvedValue({
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
    });
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

  it("shows working-tree toolbar for threads without issueIdentifier", async () => {
    getAssistantThreadMock.mockResolvedValue({
      id: 8076,
      scope: "freeform",
      agentKind: "codex",
      projectSlug: "macro-markets",
      projectName: "Macro Markets",
      issueIdentifier: null,
      workspacePath: "/workspaces/macro-markets/flaky-pipe",
      title: "Workspace: flaky-pipe",
      status: "active",
      preview: null,
      updatedAt: "2026-07-20T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <SessionPreviewDockContext.Provider value={{ openIssueIdentifier: null, togglePreview: vi.fn() }}>
          <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
            <SessionEnvironmentDockContext.Provider
              value={{ openIssueIdentifier: null, toggleEnvironment: vi.fn() }}
            >
              <SessionTasksDockContext.Provider value={{ openIssueIdentifier: null, toggleTasks: vi.fn() }}>
                <AssistantSessionTabContent projectSlug="macro-markets" threadId={8076} view="board" />
              </SessionTasksDockContext.Provider>
            </SessionEnvironmentDockContext.Provider>
          </SessionTerminalDockContext.Provider>
        </SessionPreviewDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /diff/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open issue/i })).toBeNull();
    expect(screen.getByText(/flaky-pipe/i)).toBeInTheDocument();
    expect(screen.getByTestId("assistant-panel")).toHaveAttribute("data-has-kb-control", "true");
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

  it("does not wrap the assistant in a bordered scrolling card", async () => {
    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByTestId("assistant-panel");
    expect(document.querySelector("section.rounded-xl.border.shadow-sm")).toBeNull();
    const root = screen.getByTestId("assistant-session-tab");
    expect(root).toHaveClass("overflow-hidden", "bg-background");
    expect(root).not.toHaveClass("rounded-xl", "shadow-sm");
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

  it("passes executionMode for issue_execution threads and does not mount the interactive panel", async () => {
    getAssistantThreadMock.mockResolvedValue({
      id: 9001,
      scope: "issue_execution",
      agentKind: "codex",
      projectSlug: "macro-markets",
      projectName: "Macro Markets",
      issueIdentifier: "510",
      title: "Autonomous run",
      status: "active",
      preview: null,
      updatedAt: "2026-07-17T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openIssueIdentifier: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={9001} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    const panel = await screen.findByTestId("execution-session-panel");
    expect(panel).toHaveAttribute("data-execution-mode", "true");
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });
});
