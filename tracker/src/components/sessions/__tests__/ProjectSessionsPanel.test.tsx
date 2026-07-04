import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionsChromeSetterContext,
  type ProjectSessionsChromeState,
} from "@/components/layout/ProjectSessionsChromeContext";
import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { emptyProjectSessionGroups, type ProjectSessionGroups, type ProjectSessionRow } from "@/lib/projectSessions";
import { formatDateTime } from "@/lib/utils";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { archiveAssistantThread, createProjectSessionThread } from "@/services/assistantThreads";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/issueDispatch", () => ({ dispatchIssueAgent: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ archiveAssistantThread: vi.fn(), createProjectSessionThread: vi.fn() }));
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: () => <div aria-label="mock assistant panel" />,
}));
vi.mock("@/components/issues/issue-detail/AgentTabs", () => ({
  AgentTabs: (props: { issue: { identifier: string } }) => (
    <div aria-label="mock agent tabs" data-issue={props.issue.identifier} />
  ),
}));

function SessionsChromeHarness({ children }: { children: ReactNode }) {
  const [chromeState, setChromeState] = useState<ProjectSessionsChromeState | null>(null);

  return (
    <ProjectSessionsChromeSetterContext.Provider value={setChromeState}>
      {chromeState ? (
        <button type="button" onClick={chromeState.onCreateSession} disabled={chromeState.isCreating}>
          {chromeState.isCreating ? "Creating..." : "New session"}
        </button>
      ) : null}
      {children}
    </ProjectSessionsChromeSetterContext.Provider>
  );
}

function execution(): AgentExecution {
  return {
    issueIdentifier: "DEMO-1",
    status: "saved",
    agentKind: "codex",
    sessionId: "sess-1",
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

function recentSession(): RecentSession {
  return {
    id: "chat:1",
    kind: "chat",
    scope: "issue",
    agentKind: "cursor",
    projectSlug: "demo",
    projectName: "Demo",
    title: "Issue authoring chat",
    identifier: "DEMO-2",
    threadId: 1,
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
      relatedSessions: [recentSession()],
      issues: [demoIssue()],
      executions: new Map([["DEMO-1", execution()]]),
      isLoading: false,
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
      title: "Issue authoring chat",
      status: "archived",
      preview: null,
      updatedAt: "2026-07-04T15:30:00Z",
    });
  });

  it("renders project sessions and related chats", () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Sessions/i })).toBeInTheDocument();
    expect(screen.getByText("Saved launcher work")).toBeInTheDocument();
    expect(screen.getByText("Issue authoring chat")).toBeInTheDocument();
    expect(screen.getByText(formatDateTime("2026-07-04T15:30:00Z"))).toBeInTheDocument();
    expect(screen.queryByText("Related sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open execution session DEMO-1/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open issue DEMO-1" })).toHaveAttribute(
      "href",
      "/projects/demo/board/issues/DEMO-1",
    );
    expect(screen.getByRole("img", { name: "Execution" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cursor" })).toBeInTheDocument();
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
      <MemoryRouter initialEntries={["/projects/demo/sessions"]}>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open execution session DEMO-1/i }));

    expect(screen.getByRole("tab", { name: /Saved launcher work/i })).toBeInTheDocument();
    const agentTabs = screen.getByLabelText("mock agent tabs");
    expect(agentTabs).toBeInTheDocument();
    expect(agentTabs).toHaveAttribute("data-issue", "DEMO-1");
  });

  it("restores the execution session from the exec identifier in the URL", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/sessions?exec=DEMO-1&agent=execution"]}>
        <ProjectSessionsPanel projectSlug="demo" activeExecutionIdentifier="DEMO-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: /Saved launcher work/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock agent tabs")).toHaveAttribute("data-issue", "DEMO-1");
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
      isLoading: true,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/sessions?exec=DEMO-1&agent=execution"]}>
        <ReloadHarness />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: /DEMO-1/i })).toBeInTheDocument();

    vi.mocked(useProjectSessions).mockReturnValue({
      groups: groupsWithSavedRow(),
      relatedSessions: [recentSession()],
      issues: [demoIssue()],
      executions: new Map([["DEMO-1", execution()]]),
      isLoading: false,
      error: null,
      refetch,
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh hook snapshot" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /Saved launcher work/i })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /^DEMO-1/i })).not.toBeInTheDocument();
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

  it("creates a new project session", async () => {
    renderWithI18n(
      <MemoryRouter>
        <SessionsChromeHarness>
          <ProjectSessionsPanel projectSlug="demo" />
        </SessionsChromeHarness>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New session" }));

    await waitFor(() =>
      expect(createProjectSessionThread).toHaveBeenCalledWith("demo", { title: "Project session" }),
    );
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Project session/i })).toBeInTheDocument();
  });
});
