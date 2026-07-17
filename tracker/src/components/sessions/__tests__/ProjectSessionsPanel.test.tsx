import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionsChromeSetterContext,
  type ProjectSessionsChromeState,
} from "@/components/layout/ProjectSessionsChromeContext";
import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { emptyProjectSessionGroups, type ProjectSessionGroups, type ProjectSessionRow } from "@/lib/projectSessions";
import { formatRelativeTime } from "@/lib/utils";
import { agentSectionFromSearchParams } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import {
  archiveAssistantThread,
  createProjectSessionThread,
  getAssistantThread,
} from "@/services/assistantThreads";
import { getIssue } from "@/services/issues";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/issueDispatch", () => ({ dispatchIssueAgent: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({
  archiveAssistantThread: vi.fn(),
  createProjectSessionThread: vi.fn(),
  getAssistantThread: vi.fn(),
}));
vi.mock("@/services/issues", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/issues")>();
  return { ...actual, getIssue: vi.fn() };
});
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: () => <div aria-label="mock assistant panel" />,
}));
vi.mock("@/components/sessions/AssistantSessionTabContent", () => ({
  AssistantSessionTabContent: (props: { threadId: number }) => (
    <div aria-label="mock execution session panel" data-thread={props.threadId} />
  ),
}));
vi.mock("@/components/issues/issue-detail/IssueAuthoringSessionPanel", () => ({
  IssueAuthoringSessionPanel: (props: { issue: { identifier: string } }) => (
    <div aria-label="mock authoring session panel" data-issue={props.issue.identifier} />
  ),
}));
vi.mock("@/components/assistant/IssueAuthoringPanel", () => ({
  IssueAuthoringPanel: (props: {
    identifier?: string;
    onIssueCreated?: (issue: { identifier: string }) => void;
  }) => (
    <div aria-label="mock new issue authoring panel" data-identifier={props.identifier ?? ""}>
      <button type="button" onClick={() => props.onIssueCreated?.({ identifier: "DEMO-2" })}>
        Simulate issue created
      </button>
    </div>
  ),
}));

function SessionsChromeHarness({ children }: { children: ReactNode }) {
  const [chromeState, setChromeState] = useState<ProjectSessionsChromeState | null>(null);

  return (
    <ProjectSessionsChromeSetterContext.Provider value={setChromeState}>
      {chromeState ? <span data-testid="sessions-chrome-count">{chromeState.count}</span> : null}
      {children}
    </ProjectSessionsChromeSetterContext.Provider>
  );
}

/** Mirrors ProjectSessionsPage query → props wiring for deep-link tests. */
function WorkspaceQueryHarness({ projectSlug }: { projectSlug: string }) {
  const [searchParams] = useSearchParams();
  const exec = searchParams.get("exec")?.trim() || null;
  const section = agentSectionFromSearchParams(searchParams);
  const activeAuthoringIdentifier = exec && section === "authoring" ? exec : null;
  const activeExecutionIdentifier = exec && section === "execution" ? exec : null;
  const activeNewIssue =
    searchParams.get("new") === "1" && !activeAuthoringIdentifier && !activeExecutionIdentifier;

  return (
    <ProjectSessionsPanel
      projectSlug={projectSlug}
      activeAuthoringIdentifier={activeAuthoringIdentifier}
      activeExecutionIdentifier={activeExecutionIdentifier}
      activeNewIssue={activeNewIssue}
    />
  );
}

function execution(): AgentExecution {
  return {
    issueIdentifier: "DEMO-1",
    status: "saved",
    agentKind: "codex",
    sessionId: "42",
    executionSessionId: 42,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-02T10:00:00Z",
    turnCount: 2,
    runtimeSeconds: 90,
    startedAt: "2026-07-02T09:58:30Z",
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
  };
}

function savedRow(): ProjectSessionRow {
  const item = execution();
  return {
    issueIdentifier: item.issueIdentifier,
    title: "Saved launcher work",
    agentKind: item.agentKind,
    status: item.status,
    bucket: "saved",
    lastEventAt: item.lastEventAt,
    turnCount: item.turnCount,
    runtimeSeconds: item.runtimeSeconds,
    startedAt: item.startedAt,
    goalObjective: null,
    execution: item,
  };
}

function groupsWithSavedRow(): ProjectSessionGroups {
  return {
    ...emptyProjectSessionGroups(),
    saved: [savedRow()],
  };
}

function demoIssue(): Issue {
  return {
    id: "DEMO-1",
    identifier: "DEMO-1",
    projectSlug: "demo",
    status: "Todo",
    title: "Saved launcher work",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-02T09:00:00Z",
    updatedAt: "2026-07-02T09:00:00Z",
    attachments: [],
  };
}

function authoringIssue(): Issue {
  return {
    ...demoIssue(),
    id: "DEMO-2",
    identifier: "DEMO-2",
    title: "Issue authoring chat",
  };
}

function relatedProjectSession(): RecentSession {
  return {
    id: "chat:1",
    kind: "chat",
    scope: "project_session",
    agentKind: "cursor",
    projectSlug: "demo",
    projectName: "Demo",
    title: "Project chat",
    identifier: null,
    threadId: 1,
    status: "Active",
    statusKind: "active",
    preview: "Discussing the project",
    updatedAt: "2026-07-04T15:30:00Z",
  };
}

function recentSession(): RecentSession {
  return {
    id: "chat:2",
    kind: "chat",
    scope: "issue",
    agentKind: "cursor",
    projectSlug: "demo",
    projectName: "Demo",
    title: "Issue authoring chat",
    identifier: "DEMO-2",
    threadId: 2,
    status: "Active",
    statusKind: "active",
    preview: "Discussing the issue",
    updatedAt: "2026-07-04T15:30:00Z",
  };
}

describe("ProjectSessionsPanel", () => {
  const refetch = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: groupsWithSavedRow(),
      relatedSessions: [recentSession(), relatedProjectSession()],
      issues: [demoIssue(), authoringIssue()],
      executions: new Map([["DEMO-1", execution()]]),
      inventory: null,
      isLoading: false,
      isSessionsLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });
    vi.mocked(dispatchIssueAgent).mockResolvedValue({
      action: "resume",
      message: "Resuming DEMO-1",
      issue: {} as never,
    });
    vi.mocked(createProjectSessionThread).mockResolvedValue({
      id: 42,
      scope: "project_session",
      agentKind: null,
      projectSlug: "demo",
      projectName: "Demo",
      issueIdentifier: null,
      workspacePath: null,
      labels: [],
      needsReview: false,
      title: "Project session",
      status: "active",
      preview: null,
      updatedAt: "2026-07-03T00:00:00Z",
    });
    vi.mocked(archiveAssistantThread).mockResolvedValue({
      id: 1,
      scope: "issue",
      agentKind: "cursor",
      projectSlug: "demo",
      projectName: "Demo",
      issueIdentifier: "DEMO-2",
      workspacePath: null,
      labels: [],
      needsReview: false,
      title: "Issue authoring chat",
      status: "archived",
      preview: null,
      updatedAt: "2026-07-04T15:30:00Z",
    });
    vi.mocked(getAssistantThread).mockResolvedValue({
      id: 42,
      scope: "issue_execution",
      agentKind: "codex",
      projectSlug: "demo",
      projectName: "Demo",
      issueIdentifier: "DEMO-1",
      workspacePath: "/tmp/DEMO-1",
      labels: [],
      needsReview: false,
      title: "Saved launcher work",
      status: "active",
      preview: null,
      updatedAt: "2026-07-02T10:00:00Z",
    });
  });

  it("renders workspace cards and related chats", () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Workspaces/i })).toBeInTheDocument();
    // One card per issue: title plus the newest thread label in the header —
    // never a second card for the execution.
    expect(screen.getAllByText("Saved launcher work").length).toBeLessThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: /DEMO-1 Saved launcher work/i })).toHaveLength(1);
    expect(screen.getAllByText("Issue authoring chat").length).toBeGreaterThan(0);
    expect(screen.getByText("Project chat")).toBeInTheDocument();
    const relativeAuthoring = formatRelativeTime("2026-07-04T15:30:00Z");
    expect(screen.getAllByText(relativeAuthoring).length).toBeGreaterThan(0);
    expect(screen.queryByText("Related sessions")).not.toBeInTheDocument();
    const demoCard = screen.getByRole("button", { name: /DEMO-1 Saved launcher work/i });
    expect(demoCard).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DEMO-2 Issue authoring chat/i })).toBeInTheDocument();
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));
    expect(screen.getAllByRole("link", { name: "Open issue DEMO-1" })[0]).toHaveAttribute(
      "href",
      "/projects/demo/board/issues/DEMO-1/sessions",
    );
    expect(screen.queryByText("Cursor Agent")).not.toBeInTheDocument();
  });

  it("archives related assistant sessions from the project sessions list", async () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const projectChat = screen.getByRole("button", { name: /Project chat/i });
    const listItem = projectChat.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Archive session/i }));

    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(1));
    expect(refetch).toHaveBeenCalled();
  });

  it("lists the orchestrator execution as a single thread row (no synthetic Autonomous row)", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const demoCard = screen.getByRole("button", { name: /DEMO-1 Saved launcher work/i });
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));

    const detail = listItem as HTMLElement;
    expect(within(detail).queryByRole("button", { name: /Open autonomous run/i })).not.toBeInTheDocument();
    expect(within(detail).queryByText(/Autonomous ·/)).not.toBeInTheDocument();
    expect(
      within(detail).getAllByRole("button", { name: "Saved launcher work" }),
    ).toHaveLength(1);
  });

  it("opens the execution thread row via the real orchestrator session id", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const demoCard = screen.getByRole("button", { name: /DEMO-1 Saved launcher work/i });
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));
    fireEvent.click(
      await within(listItem as HTMLElement).findByRole("button", { name: "Saved launcher work" }),
    );

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-thread", "42");
    expect(screen.getByRole("tab", { name: /DEMO-1/i })).toBeInTheDocument();
  });

  it("archives the execution thread from its row like any other thread", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const demoCard = screen.getByRole("button", { name: /DEMO-1 Saved launcher work/i });
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));
    fireEvent.click(
      await within(listItem as HTMLElement).findByRole("button", { name: /Remove session/i }),
    );

    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(42));
  });

  it("resolves the legacy exec deep link to the orchestrator session workspace", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=autonomous"]}>
        <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-thread", "42");
  });

  it("clears the legacy exec deep link when no orchestrator session exists", async () => {
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [],
      issues: [],
      executions: new Map(),
      inventory: null,
      isLoading: false,
      isSessionsLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=autonomous"]}>
        <WorkspaceQueryHarness projectSlug="demo" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("mock execution session panel")).not.toBeInTheDocument();
    });
  });

  it("opens the interactive authoring thread as a real session", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const demoCard = screen.getByRole("button", { name: /DEMO-2 Issue authoring chat/i });
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    fireEvent.click(within(listItem as HTMLElement).getByRole("button", { name: /^Expand$/i }));
    fireEvent.click(
      await within(listItem as HTMLElement).findByRole("button", { name: "Issue authoring chat" }),
    );

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-thread", "2");
  });

  it("restores the authoring session from the exec identifier in the URL", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=session"]}>
        <ProjectSessionsPanel projectSlug="demo" activeAuthoringIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /DEMO-1/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock authoring session panel")).toHaveAttribute("data-issue", "DEMO-1");
  });

  it("opens the ephemeral new issue tab from the new=1 workspace query", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?new=1"]}>
        <WorkspaceQueryHarness projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /New issue with assistant/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock new issue authoring panel")).toBeInTheDocument();
    expect(screen.getByLabelText("mock new issue authoring panel")).toHaveAttribute("data-identifier", "");
  });

  it("morphs the new issue tab into an authoring session when an issue is created", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?new=1"]}>
        <WorkspaceQueryHarness projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Simulate issue created" }));

    expect(await screen.findByLabelText("mock authoring session panel")).toHaveAttribute("data-issue", "DEMO-2");
    expect(screen.queryByLabelText("mock new issue authoring panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /New issue with assistant/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /DEMO-2/i })).toBeInTheDocument();
  });

  it("prefers an exec authoring session over the new-issue query", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?new=1&exec=DEMO-1&agent=authoring"]}>
        <WorkspaceQueryHarness projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /DEMO-1/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock authoring session panel")).toHaveAttribute("data-issue", "DEMO-1");
    expect(screen.queryByLabelText("mock new issue authoring panel")).not.toBeInTheDocument();
  });

  it("opens the orchestrator session when executionSessionId arrives after reload", async () => {
    function ReloadHarness() {
      const [, setVersion] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setVersion((version) => version + 1)}>
            Refresh hook snapshot
          </button>
          <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier="DEMO-1" />
        </>
      );
    }

    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [],
      issues: [],
      executions: new Map(),
      inventory: null,
      isLoading: true,
      isSessionsLoading: true,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=autonomous"]}>
        <ReloadHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("mock execution session panel")).not.toBeInTheDocument();
    });

    vi.mocked(useProjectSessions).mockReturnValue({
      groups: groupsWithSavedRow(),
      relatedSessions: [recentSession(), relatedProjectSession()],
      issues: [demoIssue()],
      executions: new Map([["DEMO-1", execution()]]),
      inventory: null,
      isLoading: false,
      isSessionsLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh hook snapshot" }));

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-thread", "42");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /DEMO-1/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("tab", { name: /Saved launcher work · (Execution|Autonomous|Session)/i })).not.toBeInTheDocument();
  });

  it("resumes a saved session from the workspace row menu", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    const demoCard = screen.getByRole("button", { name: /DEMO-1 Saved launcher work/i });
    const listItem = demoCard.closest("li");
    expect(listItem).not.toBeNull();
    await user.click(within(listItem as HTMLElement).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Resume" }));

    await waitFor(() =>
      expect(dispatchIssueAgent).toHaveBeenCalledWith("demo", "DEMO-1", { action: "resume" }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("publishes the sessions count to the project header chrome", async () => {
    renderWithI18n(
      <MemoryRouter>
        <SessionsChromeHarness>
          <ProjectSessionsPanel projectSlug="demo" />
        </SessionsChromeHarness>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("sessions-chrome-count")).toBeInTheDocument();
  });
});
