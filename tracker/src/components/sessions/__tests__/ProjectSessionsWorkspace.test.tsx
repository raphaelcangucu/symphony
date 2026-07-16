import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionsChromeSetterContext,
  type ProjectSessionsChromeState,
} from "@/components/layout/ProjectSessionsChromeContext";
import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { createSiblingSession } from "@/lib/createSiblingSession";
import { emptyProjectSessionGroups } from "@/lib/projectSessions";
import { archiveAssistantThread, getAssistantThread } from "@/services/assistantThreads";
import { removeWorkspaces } from "@/services/worktrees";

const projectAssistantPanel = vi.fn((props: { contentMaxWidth?: string }) => (
  <div aria-label="mock assistant panel" data-content-max-width={props.contentMaxWidth} />
));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: vi.fn(async () => []),
  archiveAssistantThread: vi.fn(async () => ({ id: 99 })),
  getAssistantThread: vi.fn(),
}));
vi.mock("@/lib/createSiblingSession", () => ({
  createSiblingSession: vi.fn(),
}));
vi.mock("@/services/worktrees", () => ({
  removeWorkspaces: vi.fn(),
}));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: { contentMaxWidth?: string }) => projectAssistantPanel(props),
}));
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function SessionsChromeHarness({ children }: { children: ReactNode }) {
  const [chromeState, setChromeState] = useState<ProjectSessionsChromeState | null>(null);

  return (
    <ProjectSessionsChromeSetterContext.Provider value={setChromeState}>
      {chromeState ? <span data-testid="sessions-chrome-count">{chromeState.count}</span> : null}
      {children}
    </ProjectSessionsChromeSetterContext.Provider>
  );
}

describe("ProjectSessionsWorkspace", () => {
  const refetch = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    window.localStorage.clear();
    vi.clearAllMocks();
    navigateMock.mockReset();
    vi.mocked(getAssistantThread).mockResolvedValue({
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
      updatedAt: "2026-07-15T12:00:00Z",
    });
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [],
      issues: [],
      executions: new Map(),
      inventory: null,
      isLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });
  });

  it("omits the duplicate sessions page header", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("project-sessions-compact-header")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Project sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("All assistant chats and agent runs related to this project.")).not.toBeInTheDocument();
  });

  it("publishes the sessions count to the project header chrome", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <SessionsChromeHarness>
          <ProjectSessionsWorkspace projectSlug="demo" />
        </SessionsChromeHarness>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("sessions-chrome-count")).toHaveTextContent("0");
  });

  it("renders a minimal toolbar and expands workspace rows as an accordion", async () => {
    const user = userEvent.setup();
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [],
      issues: [
        {
          id: "1",
          identifier: "DEMO-1",
          projectSlug: "demo",
          status: "Todo",
          title: "Fix login race",
          description: null,
          priority: null,
          position: 0,
          labels: [],
          blockedBy: [],
          assignee: null,
          creator: null,
          url: null,
          branchName: null,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          attachments: [],
        },
      ],
      executions: new Map([
        [
          "DEMO-1",
          {
            issueIdentifier: "DEMO-1",
            status: "live",
            agentKind: "codex",
            sessionId: "sess-1",
            lastEvent: null,
            lastMessage: null,
            lastEventAt: "2026-07-02T10:00:00Z",
            turnCount: 3,
            runtimeSeconds: 120,
            startedAt: "2026-07-02T09:58:00Z",
            retryAttempt: 0,
            error: null,
            goal: null,
            longRunning: false,
            longRunningKind: null,
            longRunningLabel: null,
            tokens: null,
          },
        ],
      ]),
      inventory: {
        totals: { count: 1, sizeBytes: 1024, reclaimableBytes: 0 },
        entries: [
          {
            path: "/ws/demo",
            displayName: null,
            kind: "project",
            issueIdentifier: null,
            name: null,
            classification: "active",
            reclaimable: false,
            workPresent: false,
            executionStatus: null,
            removable: false,
            sizeBytes: 1024,
            repos: [],
            childWorktrees: [],
          },
        ],
      },
      isLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
    expect(screen.getByText("1 trees · 1.0 KB")).toBeVisible();
    const list = screen.getByRole("list", { name: "Workspaces" });
    expect(list).toBeVisible();
    expect(list.parentElement).toHaveClass("mx-auto", "max-w-3xl");
    expect(screen.queryByRole("button", { name: "Session" })).not.toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /Fix login race/ }));
    expect(screen.getByRole("button", { name: "Session" })).toBeVisible();

    await user.click(within(list).getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Session" })).toBeVisible();

    await user.keyboard("{Escape}");
    await user.click(within(list).getByRole("button", { name: /Fix login race/ }));
    expect(screen.queryByRole("button", { name: "Session" })).not.toBeInTheDocument();
  });

  it("confirms issue workspace removal, removes the tree, and archives linked sessions", async () => {
    const user = userEvent.setup();
    vi.mocked(removeWorkspaces).mockResolvedValue([
      { path: "/ws/demo/DEMO-1", status: "removed", reason: null },
    ]);
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [
        {
          id: "chat-99",
          kind: "chat",
          scope: "issue_session",
          agentKind: null,
          projectSlug: "demo",
          projectName: "Demo",
          title: "Spike notes",
          identifier: "DEMO-1",
          threadId: 99,
          status: "active",
          statusKind: "active",
          preview: null,
          updatedAt: "2026-07-02T11:00:00Z",
        },
      ],
      issues: [
        {
          id: "1",
          identifier: "DEMO-1",
          projectSlug: "demo",
          status: "Todo",
          title: "Fix login race",
          description: null,
          priority: null,
          position: 0,
          labels: [],
          blockedBy: [],
          assignee: null,
          creator: null,
          url: null,
          branchName: null,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          attachments: [],
        },
      ],
      executions: new Map(),
      inventory: {
        totals: { count: 1, sizeBytes: 2048, reclaimableBytes: 0 },
        entries: [
          {
            path: "/ws/demo/DEMO-1",
            displayName: null,
            kind: "issue",
            issueIdentifier: "DEMO-1",
            name: null,
            classification: "active",
            reclaimable: false,
            workPresent: false,
            executionStatus: null,
            removable: true,
            sizeBytes: 2048,
            repos: [],
            childWorktrees: [],
          },
        ],
      },
      isLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    const list = screen.getByRole("list", { name: "Workspaces" });
    expect(within(list).getByRole("button", { name: /Remove workspace/i })).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));

    expect(await screen.findByRole("heading", { name: /Remove workspace/i })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));

    await waitFor(() =>
      expect(removeWorkspaces).toHaveBeenCalledWith("demo", ["/ws/demo/DEMO-1"]),
    );
    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(99));
    expect(refetch).toHaveBeenCalled();
  });

  it("archives a nested session without confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [
        {
          id: "chat-99",
          kind: "chat",
          scope: "issue_session",
          agentKind: null,
          projectSlug: "demo",
          projectName: "Demo",
          title: "Spike notes",
          identifier: "DEMO-1",
          threadId: 99,
          status: "active",
          statusKind: "active",
          preview: null,
          updatedAt: "2026-07-02T11:00:00Z",
        },
      ],
      issues: [
        {
          id: "1",
          identifier: "DEMO-1",
          projectSlug: "demo",
          status: "Todo",
          title: "Fix login race",
          description: null,
          priority: null,
          position: 0,
          labels: [],
          blockedBy: [],
          assignee: null,
          creator: null,
          url: null,
          branchName: null,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          attachments: [],
        },
      ],
      executions: new Map(),
      inventory: {
        totals: { count: 1, sizeBytes: 2048, reclaimableBytes: 0 },
        entries: [
          {
            path: "/ws/demo/DEMO-1",
            displayName: null,
            kind: "issue",
            issueIdentifier: "DEMO-1",
            name: null,
            classification: "active",
            reclaimable: false,
            workPresent: false,
            executionStatus: null,
            removable: true,
            sizeBytes: 2048,
            repos: [],
            childWorktrees: [],
          },
        ],
      },
      isLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    const list = screen.getByRole("list", { name: "Workspaces" });
    await user.click(within(list).getByRole("button", { name: /Fix login race/ }));

    await user.click(within(list).getByRole("button", { name: /Remove session/i }));
    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(99));
    expect(screen.queryByRole("heading", { name: /Remove workspace/i })).not.toBeInTheDocument();
  });

  it("selects an active thread tab from the route", async () => {
    const { container } = renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces/42"]}>
        <ProjectSessionsWorkspace projectSlug="demo" activeThreadId={42} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Project session/i })).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByLabelText("mock assistant panel")).toBeInTheDocument();
    expect(container.querySelector("main > div")).toHaveClass("w-full");
    expect(container.querySelector("main > div")).not.toHaveClass("max-w-[min(100%,96rem)]");
    expect(screen.getByLabelText("mock assistant panel")).toHaveAttribute("data-content-max-width", "default");
  });

  it("omits the sibling session button on the workspaces list tab", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: /^New session$/i })).not.toBeInTheDocument();
  });

  it("creates a sibling session from the tab bar and opens it", async () => {
    const user = userEvent.setup();
    const sourceThread = {
      id: 42,
      scope: "project_session",
      agentKind: "cursor" as const,
      projectSlug: "demo",
      projectName: "Demo",
      issueIdentifier: null,
      workspacePath: "/ws/demo",
      labels: [],
      needsReview: false,
      title: "Project session",
      status: "active",
      preview: null,
      updatedAt: "2026-07-15T12:00:00Z",
    };
    vi.mocked(getAssistantThread).mockResolvedValue(sourceThread);
    vi.mocked(createSiblingSession).mockResolvedValue({ ...sourceThread, id: 99, title: null });

    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces/42"]}>
        <ProjectSessionsWorkspace projectSlug="demo" activeThreadId={42} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Project session/i })).toHaveAttribute("aria-selected", "true"),
    );

    await user.click(screen.getByRole("button", { name: /^New session$/i }));

    await waitFor(() => {
      expect(getAssistantThread).toHaveBeenCalledWith(42);
      expect(createSiblingSession).toHaveBeenCalledWith(sourceThread);
      expect(navigateMock).toHaveBeenCalledWith("/projects/demo/workspaces/99", { replace: true });
    });
  });
});
