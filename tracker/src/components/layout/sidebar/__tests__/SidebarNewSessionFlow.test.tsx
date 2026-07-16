import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarNewSessionFlow } from "@/components/layout/sidebar/SidebarNewSessionFlow";
import { initTestI18n } from "@/i18n/testUtils";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const createFreeformThread = vi.hoisted(() => vi.fn());
const createProjectSessionThread = vi.hoisted(() => vi.fn());
const createIssueSessionThread = vi.hoisted(() => vi.fn());
const listIssues = vi.hoisted(() => vi.fn());
const fetchAssistantCatalogBundle = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createFreeformThread,
  createProjectSessionThread,
  createIssueSessionThread,
}));

vi.mock("@/services/issues", () => ({
  listIssues,
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle,
}));

vi.mock("@/components/assistant/ExecutionSettingsFields", () => ({
  ExecutionSettingsFields: ({
    agent,
    onAgentChange,
  }: {
    agent: string;
    onAgentChange: (next: string) => void;
  }) => (
    <label>
      Agent
      <select
        aria-label="Agent"
        value={agent}
        onChange={(event) => onAgentChange(event.target.value)}
      >
        <option value="codex">codex</option>
        <option value="cursor">cursor</option>
        <option value="claude">claude</option>
      </select>
    </label>
  ),
}));

vi.mock("@/components/sessions/NewStandaloneWorkspaceDialog", () => ({
  NewStandaloneWorkspaceDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated(path: string, threadId: number): void;
  }) =>
    open ? (
      <button type="button" onClick={() => onCreated("/work/acme/new", 91)}>
        Finish workspace
      </button>
    ) : null,
}));

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:7",
    projectSlug: "acme",
    workspaceId: "workspace:main",
    sessionKind: "chat",
    title: "Résumé API",
    subtitle: "Claude · active",
    href: "/projects/acme/workspaces/7",
    statusKind: "active",
    aggregateStatus: "active",
    agentKind: "claude",
    updatedAt: "2026-07-13T10:00:00.000Z",
    threadId: 7,
    issueIdentifier: null,
    archived: false,
    unread: true,
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: false,
    ...overrides,
  };
}

function workspace(overrides: Partial<SidebarWorkspaceNode> = {}): SidebarWorkspaceNode {
  return {
    kind: "workspace",
    id: "workspace:main",
    projectSlug: "acme",
    workspaceKind: "project",
    title: "Main",
    subtitle: "main",
    href: "/projects/acme/workspaces",
    branchSummary: "main",
    aggregateStatus: "idle",
    updatedAt: "2026-07-13T10:00:00.000Z",
    inventory: {
      path: "/work/acme",
      displayName: null,
      kind: "project",
      issueIdentifier: null,
      name: null,
      classification: "active",
      reclaimable: false,
      workPresent: true,
      executionStatus: null,
      removable: false,
      sizeBytes: 1,
      repos: [],
      childWorktrees: [],
    },
    issueIdentifier: null,
    sessions: [session()],
    overflowSessions: [],
    pinned: false,
    ...overrides,
  };
}

function project(overrides: Partial<SidebarProjectNode> = {}): SidebarProjectNode {
  return {
    kind: "project",
    id: "acme",
    projectSlug: "acme",
    title: "Ácme",
    subtitle: "Product",
    href: "/projects/acme/board",
    archived: false,
    aggregateStatus: "idle",
    updatedAt: "2026-07-13T10:00:00.000Z",
    loadState: "ready",
    error: null,
    sessions: [],
    overflowSessions: [],
    nextCursor: null,
    workspaces: [workspace()],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

describe("SidebarNewSessionFlow", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    createFreeformThread.mockReset();
    createProjectSessionThread.mockReset();
    createIssueSessionThread.mockReset();
    listIssues.mockReset();
    fetchAssistantCatalogBundle.mockReset();
    createFreeformThread.mockResolvedValue({ id: 11 });
    createProjectSessionThread.mockResolvedValue({ id: 44 });
    createIssueSessionThread.mockResolvedValue({ id: 45 });
    listIssues.mockResolvedValue([]);
    fetchAssistantCatalogBundle.mockRejectedValue(new Error("offline"));
  });

  it("defaults to Free without sidebar project and creates a freeform thread", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: null, workspaceId: null, sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByRole("button", { name: "Free", pressed: true })).toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Initial prompt"), "triage inbox");
    await user.click(screen.getByRole("button", { name: "Create session" }));

    await waitFor(() =>
      expect(createFreeformThread).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "triage inbox",
          agentKind: "codex",
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith({
      scope: "freeform",
      projectSlug: null,
      threadId: 11,
      seed: "triage inbox",
    });
  });

  it("defaults to Project with sidebar context and creates an explore project_session", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByRole("button", { name: "Project", pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toHaveValue("acme");
    expect(screen.getByRole("button", { name: "Explore project", pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toHaveValue("workspace:main");

    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createProjectSessionThread).toHaveBeenCalledWith(
        "acme",
        expect.objectContaining({
          workspacePath: "/work/acme",
          title: "New session",
          agentKind: "codex",
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith({
      scope: "project_session",
      projectSlug: "acme",
      threadId: 44,
    });
  });

  it("toggles Free vs Project fields and requires an issue for Issue kind", async () => {
    const user = userEvent.setup();
    listIssues.mockResolvedValue([
      {
        identifier: "ACME-12",
        title: "Fix login",
        agentKind: "codex",
        status: "Todo",
      },
    ]);
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Issue" }));
    expect(screen.getByLabelText("Issue")).toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/select an issue/i);

    await waitFor(() => expect(listIssues).toHaveBeenCalled());
    await user.click(screen.getByRole("option", { name: /ACME-12/i }));
    expect(screen.getByRole("button", { name: "Create session" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createIssueSessionThread).toHaveBeenCalledWith(
        "acme",
        "ACME-12",
        expect.objectContaining({
          title: "ACME-12 Fix login",
          agentKind: "codex",
        }),
      ),
    );
  });

  it("blocks duplicate submit and ignores stale create after close", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: { id: number }) => void;
    createProjectSessionThread.mockImplementation(
      () => new Promise<{ id: number }>((done) => (resolveCreate = done)),
    );
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const selection = {
      projectSlug: "acme",
      workspaceId: "workspace:main",
      sessionId: null,
    };
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={selection}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    const submit = screen.getByRole("button", { name: "Create session" });
    await user.dblClick(submit);
    expect(createProjectSessionThread).toHaveBeenCalledTimes(1);

    rerender(
      <SidebarNewSessionFlow
        open={false}
        selection={selection}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
    resolveCreate({ id: 99 });
    await Promise.resolve();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("reuses a newly created workspace thread from the nested dialog", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create new workspace" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Finish workspace"));
    expect(onCreated).toHaveBeenCalledWith({
      scope: "project_session",
      projectSlug: "acme",
      threadId: 91,
    });
  });
});
