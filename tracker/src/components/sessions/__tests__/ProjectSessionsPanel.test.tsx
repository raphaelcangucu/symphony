import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { emptyProjectSessionGroups, type ProjectSessionGroups, type ProjectSessionRow } from "@/lib/projectSessions";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { createProjectSessionThread } from "@/services/assistantThreads";
import type { AgentExecution } from "@/types/agent-execution";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/issueDispatch", () => ({ dispatchIssueAgent: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ createProjectSessionThread: vi.fn() }));
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: () => <div aria-label="mock assistant panel" />,
}));

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
    updatedAt: "2026-07-02T10:00:00Z",
  };
}

describe("ProjectSessionsPanel", () => {
  const refetch = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    vi.clearAllMocks();
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: groupsWithSavedRow(),
      relatedSessions: [recentSession()],
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
  });

  it("renders project sessions and related chats", () => {
    renderWithI18n(
      <MemoryRouter>
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("Saved launcher work")).toBeInTheDocument();
    expect(screen.getByText("Issue authoring chat")).toBeInTheDocument();
    expect(screen.queryByText("Related sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open execution session DEMO-1/i })).toHaveAttribute(
      "href",
      "/projects/demo/board/issues/DEMO-1/agent?agent=execution",
    );
    expect(screen.getByRole("img", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cursor Agent" })).toBeInTheDocument();
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
        <ProjectSessionsPanel projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    await waitFor(() =>
      expect(createProjectSessionThread).toHaveBeenCalledWith("demo", { title: "Project session" }),
    );
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Project session/i })).toBeInTheDocument();
  });
});
