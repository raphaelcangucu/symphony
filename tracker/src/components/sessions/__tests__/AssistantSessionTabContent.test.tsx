import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { SessionEnvironmentDockContext } from "@/components/sessions/sessionEnvironmentDockContext";
import { SessionPreviewDockContext } from "@/components/sessions/sessionPreviewDockContext";
import { SessionTasksDockContext } from "@/components/sessions/sessionTasksDockContext";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { initTestI18n } from "@/i18n/testUtils";
import { issueWorkspaceScope, threadWorkspaceScope } from "@/lib/workspaceScope";

vi.mock("@/hooks/useWorkspaceDiffStats", () => ({
  useWorkspaceDiffStats: () => ({ additions: 12, deletions: 3 }),
}));

const knowledgeBaseControlChangeMock = vi.hoisted(() => vi.fn());
const openKnowledgeBaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: ({
    diffRequestId,
    executionMode,
    onKnowledgeBaseControlChange,
  }: {
    diffRequestId?: number;
    executionMode?: boolean;
    onKnowledgeBaseControlChange?: unknown;
  }) => {
    knowledgeBaseControlChangeMock(onKnowledgeBaseControlChange);
    return (
      <div
        data-testid={executionMode ? "execution-session-panel" : "assistant-panel"}
        data-diff-request-id={diffRequestId ?? 0}
        data-execution-mode={executionMode ? "true" : "false"}
        data-has-kb-control={onKnowledgeBaseControlChange ? "true" : "false"}
      />
    );
  },
}));

const useIssueEditorMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: (...args: unknown[]) => useIssueEditorMock(...args),
}));

const availableEditor = {
  browser: { available: true, url: "https://code.example/510", reason: null },
  cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
  loading: false,
};

const getAssistantThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  getAssistantThread: (...args: unknown[]) => getAssistantThreadMock(...args),
  listAssistantThreads: vi.fn(),
}));

describe("AssistantSessionTabContent", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    useIssueEditorMock.mockReset();
    useIssueEditorMock.mockReturnValue(availableEditor);
    getAssistantThreadMock.mockReset();
    knowledgeBaseControlChangeMock.mockReset();
    openKnowledgeBaseMock.mockReset();
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

  it("keeps every issue working-tree action wired to the issue scope", async () => {
    const user = userEvent.setup();
    const togglePreview = vi.fn();
    const toggleTerminal = vi.fn();
    const toggleEnvironment = vi.fn();
    const toggleTasks = vi.fn();
    const scope = issueWorkspaceScope("macro-markets", "510", 7996);

    render(
      <MemoryRouter>
        <SessionPreviewDockContext.Provider value={{ openScope: null, togglePreview }}>
          <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal }}>
            <SessionEnvironmentDockContext.Provider
              value={{ openScope: null, toggleEnvironment }}
            >
              <SessionTasksDockContext.Provider value={{ openScope: null, toggleTasks }}>
                <AssistantSessionTabContent
                  projectSlug="macro-markets"
                  threadId={7996}
                  view="board"
                />
              </SessionTasksDockContext.Provider>
            </SessionEnvironmentDockContext.Provider>
          </SessionTerminalDockContext.Provider>
        </SessionPreviewDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Open issue 510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/sessions",
    );
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open in code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Terminal for 510" }));
    await user.click(screen.getByRole("button", { name: "Preview for 510" }));
    await user.click(screen.getByRole("button", { name: "Environment for 510" }));
    await user.click(screen.getByRole("button", { name: "Tasks for 510" }));

    expect(toggleTerminal).toHaveBeenCalledWith(scope);
    expect(togglePreview).toHaveBeenCalledWith(scope);
    expect(toggleEnvironment).toHaveBeenCalledWith(scope);
    expect(toggleTasks).toHaveBeenCalledWith(scope);
  });

  it("shows working-tree toolbar for threads without issueIdentifier", async () => {
    const user = userEvent.setup();
    const togglePreview = vi.fn();
    const toggleTerminal = vi.fn();
    const toggleEnvironment = vi.fn();
    const toggleTasks = vi.fn();
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
        <SessionPreviewDockContext.Provider value={{ openScope: null, togglePreview }}>
          <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal }}>
            <SessionEnvironmentDockContext.Provider
              value={{ openScope: null, toggleEnvironment }}
            >
              <SessionTasksDockContext.Provider value={{ openScope: null, toggleTasks }}>
                <AssistantSessionTabContent projectSlug="macro-markets" threadId={8076} view="board" />
              </SessionTasksDockContext.Provider>
            </SessionEnvironmentDockContext.Provider>
          </SessionTerminalDockContext.Provider>
        </SessionPreviewDockContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /diff/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal for flaky-pipe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview for flaky-pipe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Environment for flaky-pipe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks for flaky-pipe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open in code/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open issue/i })).toBeNull();
    expect(screen.getByText(/flaky-pipe/i)).toBeInTheDocument();
    expect(useIssueEditorMock).toHaveBeenCalledWith({
      projectSlug: "macro-markets",
      identifier: null,
      threadId: 8076,
      enabled: true,
    });
    expect(screen.getByTestId("assistant-panel")).toHaveAttribute("data-has-kb-control", "true");

    const reportKnowledgeBaseControl = knowledgeBaseControlChangeMock.mock.lastCall?.[0] as
      | ((control: { open: () => void; changedDocCount: number }) => void)
      | undefined;
    expect(reportKnowledgeBaseControl).toBeTypeOf("function");
    act(() => {
      reportKnowledgeBaseControl?.({
        open: openKnowledgeBaseMock,
        changedDocCount: 0,
      });
    });
    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(openKnowledgeBaseMock).toHaveBeenCalledOnce();

    const scope = threadWorkspaceScope(
      "macro-markets",
      8076,
      "/workspaces/macro-markets/flaky-pipe",
    );
    await user.click(screen.getByRole("button", { name: "Terminal for flaky-pipe" }));
    await user.click(screen.getByRole("button", { name: "Preview for flaky-pipe" }));
    await user.click(screen.getByRole("button", { name: "Environment for flaky-pipe" }));
    await user.click(screen.getByRole("button", { name: "Tasks for flaky-pipe" }));

    expect(toggleTerminal).toHaveBeenCalledWith(scope);
    expect(togglePreview).toHaveBeenCalledWith(scope);
    expect(toggleEnvironment).toHaveBeenCalledWith(scope);
    expect(toggleTasks).toHaveBeenCalledWith(scope);
  });

  it("disables Code with the workspace-missing tooltip for an unprovisioned thread", async () => {
    const toggleTasks = vi.fn();
    getAssistantThreadMock.mockResolvedValue({
      id: 8080,
      scope: "freeform",
      agentKind: "codex",
      projectSlug: "macro-markets",
      projectName: "Macro Markets",
      issueIdentifier: null,
      workspacePath: null,
      title: "Unprovisioned workspace",
      status: "active",
      preview: null,
      updatedAt: "2026-07-20T00:00:00Z",
    });
    useIssueEditorMock.mockReturnValue({
      browser: { available: false, url: null, reason: "workspace_missing" },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
      loading: false,
    });

    render(
      <MemoryRouter>
        <SessionTasksDockContext.Provider value={{ openScope: null, toggleTasks }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={8080} view="board" />
        </SessionTasksDockContext.Provider>
      </MemoryRouter>,
    );

    const codeButton = await screen.findByRole("button", { name: /open in code/i });
    expect(codeButton).toBeDisabled();
    expect(codeButton).toHaveAttribute(
      "title",
      "Workspace not created yet — run the agent or open the terminal first",
    );
    expect(screen.getByTestId("tasks-dock-toolbar-toggle")).toBeEnabled();
  });

  it("toggles the workspace terminal dock instead of navigating to the issue drawer", async () => {
    const user = userEvent.setup();
    const toggleTerminal = vi.fn();

    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Terminal for 510" }));

    expect(toggleTerminal).toHaveBeenCalledWith(issueWorkspaceScope("macro-markets", "510", 7996));
  });

  it("shows diff line counters next to the toolbar diff button", async () => {
    render(
      <MemoryRouter>
        <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal: vi.fn() }}>
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
        <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal: vi.fn() }}>
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
        <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal: vi.fn() }}>
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
        <SessionTerminalDockContext.Provider value={{ openScope: null, toggleTerminal: vi.fn() }}>
          <AssistantSessionTabContent projectSlug="macro-markets" threadId={9001} view="board" />
        </SessionTerminalDockContext.Provider>
      </MemoryRouter>,
    );

    const panel = await screen.findByTestId("execution-session-panel");
    expect(panel).toHaveAttribute("data-execution-mode", "true");
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });
});
