import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarNewSessionFlow } from "@/components/layout/sidebar/SidebarNewSessionFlow";
import {
  buildSidebarSearchResults,
  localizeSidebarSearchStatus,
  SidebarSearchLauncher,
} from "@/components/layout/sidebar/SidebarSearchLauncher";
import { SidebarUtilityNav } from "@/components/layout/sidebar/SidebarUtilityNav";
import { initTestI18n } from "@/i18n/testUtils";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const createProjectSessionThread = vi.hoisted(() => vi.fn());
const createIssueSessionThread = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  createProjectSessionThread,
  createIssueSessionThread,
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
    workspaces: [workspace()],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

describe("sidebar utility navigation", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    createProjectSessionThread.mockReset();
    createIssueSessionThread.mockReset();
    createProjectSessionThread.mockResolvedValue({ id: 44 });
    createIssueSessionThread.mockResolvedValue({ id: 45 });
  });

  it("renders compact actions and routes in both locales", async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    const onSearch = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <SidebarUtilityNav onNewSession={onNewSession} onSearch={onSearch} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New session" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Automations" })).toHaveAttribute(
      "href",
      "/settings/templates",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    const expectedShortcut = /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? "")
      ? "⌘K"
      : "Ctrl+K";
    expect(screen.getByText(expectedShortcut)).toBeInTheDocument();

    await initTestI18n("pt-BR");
    rerender(
      <MemoryRouter>
        <SidebarUtilityNav onNewSession={onNewSession} onSearch={onSearch} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Nova sessão" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Automações" })).toBeInTheDocument();
  });

  it("normalizes search, includes overflow and unassigned, and deduplicates malformed nodes", () => {
    const overflow = workspace({
      id: "workspace:overflow",
      title: "Overflow",
      sessions: [],
      overflowSessions: [session({ id: "thread:9", title: "Café report", workspaceId: "workspace:overflow" })],
    });
    const unassigned = session({
      id: "thread:10",
      title: "Loose chat",
      workspaceId: null,
      href: "/projects/acme/workspaces/10",
    });
    const tree = [
      project({ overflowWorkspaces: [overflow], unassignedSessions: [unassigned] }),
      { kind: "project", id: "broken" },
    ] as unknown as SidebarProjectNode[];

    expect(buildSidebarSearchResults(tree, "  resume ")).toHaveLength(1);
    expect(buildSidebarSearchResults(tree, "CAFE")[0]?.id).toBe("thread:9");
    expect(buildSidebarSearchResults(tree, "loose")[0]?.context).toContain("Ácme");
    expect(new Set(buildSidebarSearchResults(tree, "").map(({ id }) => id)).size).toBe(
      buildSidebarSearchResults(tree, "").length,
    );
  });

  it("opens a search result with keyboard selection and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onOpenNode = vi.fn();
    render(
      <SidebarSearchLauncher
        open
        tree={[project()]}
        onOpenChange={onOpenChange}
        onOpenNode={onOpenNode}
      />,
    );

    await user.type(screen.getByPlaceholderText("Search projects and sessions…"), "resume");
    const result = screen.getByRole("option", { name: /Résumé API/i });
    result.focus();
    await user.keyboard("{Enter}");
    expect(onOpenNode).toHaveBeenCalledWith("/projects/acme/workspaces/7");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a compact ready-route confirmation and reveals selectors only after Change", async () => {
    const user = userEvent.setup();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("Ácme");
    expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("Main");
    expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("Project default");
    expect(screen.getByRole("button", { name: "Create session" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Project")).toHaveValue("acme");
    expect(screen.getByLabelText("Workspace")).toHaveValue("workspace:main");
    expect(screen.queryByRole("button", { name: "Create session" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review session" })).toBeInTheDocument();
  });

  it("preselects a ready workspace and sends exact main and issue paths", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByText(/Main/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createProjectSessionThread).toHaveBeenCalledWith("acme", {
        workspacePath: "/work/acme",
      }),
    );

    const issueWorkspace = workspace({
      id: "workspace:issue",
      workspaceKind: "issue",
      title: "ACME-12",
      issueIdentifier: "ACME-12",
      inventory: { ...workspace().inventory!, path: "/work/acme-12", issueIdentifier: "ACME-12" },
      sessions: [],
    });
    rerender(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:issue", sessionId: null }}
        tree={[project({ workspaces: [issueWorkspace] })]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("ACME-12"),
    );
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createIssueSessionThread).toHaveBeenCalledWith("acme", "ACME-12", {
        workspacePath: "/work/acme-12",
      }),
    );
  });

  it("restores deferred workspace and session routes once without overwriting manual changes", async () => {
    const user = userEvent.setup();
    const ensureProjectExpanded = vi.fn();
    const routeSelection = {
      projectSlug: "acme",
      workspaceId: null,
      sessionId: "thread:deferred",
    };
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={routeSelection}
        tree={[project({ loadState: "loading", workspaces: [] })]}
        ensureProjectExpanded={ensureProjectExpanded}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(ensureProjectExpanded).toHaveBeenCalledOnce();

    const deferredWorkspace = workspace({
      id: "workspace:deferred",
      title: "Deferred",
      sessions: [],
      overflowSessions: [
        session({ id: "thread:deferred", workspaceId: "workspace:deferred" }),
      ],
    });
    rerender(
      <SidebarNewSessionFlow
        open
        selection={routeSelection}
        tree={[project({ workspaces: [deferredWorkspace] })]}
        ensureProjectExpanded={ensureProjectExpanded}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("Deferred"),
    );

    const directSelection = {
      projectSlug: "acme",
      workspaceId: "workspace:late",
      sessionId: null,
    };
    rerender(
      <SidebarNewSessionFlow
        open
        selection={directSelection}
        tree={[project({ workspaces: [workspace({ id: "workspace:manual", title: "Manual" })] })]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Workspace"), "workspace:manual");
    rerender(
      <SidebarNewSessionFlow
        open
        selection={directSelection}
        tree={[
          project({
            workspaces: [
              workspace({ id: "workspace:manual", title: "Manual" }),
              workspace({ id: "workspace:late", title: "Late" }),
            ],
          }),
        ]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByLabelText("Workspace")).toHaveValue("workspace:manual");
  });

  it("localizes known search statuses in both locales and safely falls back for unknown values", async () => {
    const { rerender } = render(
      <SidebarSearchLauncher
        open
        tree={[project()]}
        onOpenChange={() => {}}
        onOpenNode={() => {}}
      />,
    );
    expect(screen.getByText(/Session · Active/)).toBeInTheDocument();
    expect(localizeSidebarSearchStatus("session", "future_status")).toBe("Unknown status");

    await initTestI18n("pt-BR");
    rerender(
      <SidebarSearchLauncher
        open
        tree={[project()]}
        onOpenChange={() => {}}
        onOpenNode={() => {}}
      />,
    );
    expect(screen.getByText(/Sessão · Ativo/)).toBeInTheDocument();
    expect(localizeSidebarSearchStatus("session", "future_status")).toBe(
      "Status desconhecido",
    );
  });

  it("sends exact standalone and parallel workspace paths", async () => {
    const user = userEvent.setup();
    const standalone = workspace({
      id: "workspace:standalone",
      workspaceKind: "standalone",
      title: "Standalone",
      inventory: { ...workspace().inventory!, path: "/work/standalone" },
      sessions: [],
    });
    const parallel = workspace({
      id: "workspace:parallel",
      workspaceKind: "parallel",
      title: "Parallel",
      issueIdentifier: "ACME-91",
      inventory: {
        ...workspace().inventory!,
        path: "/work/acme-91-p2",
        issueIdentifier: "ACME-91",
      },
      sessions: [],
    });
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: standalone.id, sessionId: null }}
        tree={[project({ workspaces: [standalone] })]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createProjectSessionThread).toHaveBeenCalledWith("acme", {
        workspacePath: "/work/standalone",
      }),
    );

    rerender(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: parallel.id, sessionId: null }}
        tree={[project({ workspaces: [parallel] })]}
        onOpenChange={() => {}}
        onCreated={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("new-session-confirmation")).toHaveTextContent("Parallel"),
    );
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(createIssueSessionThread).toHaveBeenCalledWith("acme", "ACME-91", {
        workspacePath: "/work/acme-91-p2",
      }),
    );
  });

  it("loads an unloaded project once, retries errors, guards invalid workspaces, and reuses new workspace thread", async () => {
    const user = userEvent.setup();
    const ensureProjectExpanded = vi.fn();
    const onCreated = vi.fn();
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: null, sessionId: null }}
        tree={[project({ loadState: "loading", workspaces: [] })]}
        ensureProjectExpanded={ensureProjectExpanded}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    expect(ensureProjectExpanded).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();

    rerender(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: null, sessionId: null }}
        tree={[project({ loadState: "error", error: "offline", workspaces: [] })]}
        ensureProjectExpanded={ensureProjectExpanded}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByText("offline")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(ensureProjectExpanded).toHaveBeenCalledTimes(2);

    rerender(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "removed", sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/select a workspace/i);
    await user.click(screen.getByRole("button", { name: "Create new workspace" }));
    fireEvent.click(screen.getByText("Finish workspace"));
    expect(onCreated).toHaveBeenCalledWith("acme", 91);
    expect(createProjectSessionThread).not.toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ workspacePath: "/work/acme/new" }),
    );
  });

  it("trims title, blocks duplicate submit, keeps errors visible, and clears sensitive state on close", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { id: number }) => void;
    createProjectSessionThread.mockImplementation(
      () => new Promise<{ id: number }>((done) => (resolve = done)),
    );
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(screen.getByLabelText("Session title"), "  Focus  ");
    await user.selectOptions(screen.getByLabelText("Agent"), "cursor");
    await user.click(screen.getByRole("button", { name: "Review session" }));
    const submit = screen.getByRole("button", { name: "Create session" });
    await user.dblClick(submit);
    expect(createProjectSessionThread).toHaveBeenCalledTimes(1);
    expect(createProjectSessionThread).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ title: "Focus", agentKind: "cursor" }),
    );
    resolve({ id: 55 });

    rerender(
      <SidebarNewSessionFlow
        open={false}
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={() => {}}
      />,
    );
    rerender(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByLabelText("Session title")).toHaveValue("");
    expect(within(screen.getByRole("dialog")).getByLabelText("Agent")).toHaveValue("");
  });

  it("ignores stale create resolution after close while pending", async () => {
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

    await user.click(screen.getByRole("button", { name: "Create session" }));
    expect(createProjectSessionThread).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();

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

    createProjectSessionThread.mockImplementation(
      () => new Promise<{ id: number }>((done) => (resolveCreate = done)),
    );
    rerender(
      <SidebarNewSessionFlow
        open
        selection={selection}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create session" }));
    expect(createProjectSessionThread).toHaveBeenCalledTimes(2);
    resolveCreate({ id: 100 });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("acme", 100));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("blocks dismiss while submit is in flight", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: { id: number }) => void;
    createProjectSessionThread.mockImplementation(
      () => new Promise<{ id: number }>((done) => (resolveCreate = done)),
    );
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: "workspace:main", sessionId: null }}
        tree={[project()]}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create session" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveCreate({ id: 61 });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("acme", 61));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the session dialog while the create-workspace dialog is open", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <SidebarNewSessionFlow
        open
        selection={{ projectSlug: "acme", workspaceId: null, sessionId: null }}
        tree={[project()]}
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create new workspace" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Finish workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Finish workspace"));
    expect(onCreated).toHaveBeenCalledWith("acme", 91);
  });

  it("keeps service rejection visible and allows one retry", async () => {
    const user = userEvent.setup();
    createProjectSessionThread
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce({ id: 77 });
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
    await user.dblClick(screen.getByRole("button", { name: "Create session" }));
    expect(createProjectSessionThread).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("service unavailable");

    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(createProjectSessionThread).toHaveBeenCalledTimes(2));
    expect(onCreated).toHaveBeenCalledWith("acme", 77);
  });
});
