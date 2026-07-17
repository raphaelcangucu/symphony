import { fireEvent, screen, waitFor } from "@testing-library/react";
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
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import { agentSectionFromSearchParams } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { archiveAssistantThread, createProjectSessionThread } from "@/services/assistantThreads";
import { getIssue } from "@/services/issues";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/issueDispatch", () => ({ dispatchIssueAgent: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ archiveAssistantThread: vi.fn(), createProjectSessionThread: vi.fn() }));
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
vi.mock("@/components/issues/issue-detail/IssueExecutionSessionPanel", () => ({
  IssueExecutionSessionPanel: (props: { issue: { identifier: string } }) => (
    <div aria-label="mock execution session panel" data-issue={props.issue.identifier} />
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
    sessionId: "sess-1",
    executionSessionId: null,
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
  });

  it("renders workspace cards and related chats", () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Workspaces/i })).toBeInTheDocument();
    // One card per issue: the execution session is a row inside the card, not
    // a second card.
    expect(screen.getAllByText("Saved launcher work")).toHaveLength(1);
    expect(screen.getByText("Issue authoring chat")).toBeInTheDocument();
    expect(screen.getByText("Project chat")).toBeInTheDocument();
    const relativeAuthoring = formatRelativeTime("2026-07-04T15:30:00Z");
    expect(screen.getAllByText(relativeAuthoring).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(formatDateTime("2026-07-04T15:30:00Z")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Related sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open execution session DEMO-1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open authoring session DEMO-2/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open issue DEMO-1" })[0]).toHaveAttribute(
      "href",
      "/projects/demo/board/issues/DEMO-1/sessions",
    );
    expect(screen.getAllByRole("img", { name: "Codex" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Cursor" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Cursor Agent")).not.toBeInTheDocument();
  });

  it("archives related assistant sessions from the project sessions list", async () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Archive session/i }));

    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(1));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens the execution session inline instead of navigating to the issue detail", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open execution session DEMO-1/i }));

    expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toBeInTheDocument();
    const executionPanel = screen.getByLabelText("mock execution session panel");
    expect(executionPanel).toBeInTheDocument();
    expect(executionPanel).toHaveAttribute("data-issue", "DEMO-1");
  });

  it("restores the execution session from the exec identifier in the URL", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&agent=execution"]}>
        <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock execution session panel")).toHaveAttribute("data-issue", "DEMO-1");
  });

  it("focuses an existing execution tab when the exec deep link is applied again", async () => {
    function FocusHarness() {
      const [searchParams, setSearchParams] = useSearchParams();
      const exec = searchParams.get("exec")?.trim() || null;
      const section = agentSectionFromSearchParams(searchParams);
      const activeExecutionIdentifier = exec && section === "execution" ? exec : null;

      return (
        <>
          <button type="button" onClick={() => setSearchParams({})}>
            Clear deep link
          </button>
          <button type="button" onClick={() => setSearchParams({ exec: "DEMO-1", surface: "autonomous" })}>
            Apply deep link
          </button>
          <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier={activeExecutionIdentifier} />
        </>
      );
    }

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=autonomous"]}>
        <FocusHarness />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-issue", "DEMO-1");
    expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Drop the deep-link query, switch away, then re-apply the deep link.
    fireEvent.click(screen.getByRole("button", { name: "Clear deep link" }));
    fireEvent.click(screen.getByRole("tab", { name: /Workspaces/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toHaveAttribute(
        "aria-selected",
        "false",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply deep link" }));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByLabelText("mock execution session panel")).toHaveAttribute("data-issue", "DEMO-1");
  });

  it("loads the issue for an execution deep link when it is missing from the sessions list", async () => {
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
    vi.mocked(getIssue).mockResolvedValue(demoIssue());

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&surface=autonomous"]}>
        <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("mock execution session panel")).toHaveAttribute("data-issue", "DEMO-1");
    expect(getIssue).toHaveBeenCalledWith("demo", "DEMO-1");
  });

  it("opens the authoring session inline as its own workspace tab", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open authoring session DEMO-2/i }));

    expect(screen.getByRole("tab", { name: /Authoring/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock authoring session panel")).toHaveAttribute("data-issue", "DEMO-2");
  });

  it("restores the authoring session from the exec identifier in the URL", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&agent=authoring"]}>
        <ProjectSessionsPanel projectSlug="demo" activeAuthoringIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Saved launcher work · Authoring/i })).toBeInTheDocument();
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
    expect(screen.getByRole("tab", { name: /Issue authoring chat · Session/i })).toBeInTheDocument();
  });

  it("prefers an exec authoring session over the new-issue query", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces?new=1&exec=DEMO-1&agent=authoring"]}>
        <WorkspaceQueryHarness projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Saved launcher work · Session/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock authoring session panel")).toHaveAttribute("data-issue", "DEMO-1");
    expect(screen.queryByLabelText("mock new issue authoring panel")).not.toBeInTheDocument();
  });

  it("renames a restored execution tab when issue data loads after a page reload", async () => {
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
      <MemoryRouter initialEntries={["/projects/demo/workspaces?exec=DEMO-1&agent=execution"]}>
        <ReloadHarness />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: /DEMO-1 · (Execution|Autonomous)/i })).toBeInTheDocument();

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

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Saved launcher work · (Execution|Autonomous)/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("tab", { name: /^DEMO-1 · (Execution|Autonomous)/i })).not.toBeInTheDocument();
  });

  it("resumes a saved session", async () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

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
