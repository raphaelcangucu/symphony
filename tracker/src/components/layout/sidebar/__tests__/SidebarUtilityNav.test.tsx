import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listIssues = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", () => ({
  listIssues,
}));

import {
  buildSidebarIssueSearchResults,
  buildSidebarSearchResults,
  localizeSidebarSearchStatus,
  mergeSidebarSearchResults,
  SidebarSearchLauncher,
} from "@/components/layout/sidebar/SidebarSearchLauncher";
import type { Issue } from "@/types/issue";
import { SidebarUtilityNav } from "@/components/layout/sidebar/SidebarUtilityNav";
import { initTestI18n } from "@/i18n/testUtils";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

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

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "GAM-20",
    projectSlug: "gamba",
    status: "In Progress",
    title: "Floating preview surfaces",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    attachments: [],
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

describe("sidebar utility navigation", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    vi.mocked(listIssues).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.getByRole("link", { name: "Observability" })).toHaveAttribute(
      "href",
      "/observability",
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
    expect(screen.getByRole("link", { name: "Observabilidade" })).toBeInTheDocument();
  });

  it("builds issue search results with board hrefs", () => {
    const results = buildSidebarIssueSearchResults(
      [issue(), issue({ identifier: "GAM-21", title: "Other", projectSlug: "gamba" })],
      "floating",
      new Map([["gamba", "Gamba"]]),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "issue",
      id: "issue:gamba:GAM-20",
      title: "GAM-20 · Floating preview surfaces",
      context: "Gamba",
      href: "/projects/gamba/board/issues/GAM-20",
      status: "In Progress",
      projectId: "gamba",
    });
  });

  it("merges projects, issues, then sessions and dedupes by id", () => {
    const merged = mergeSidebarSearchResults(
      [
        {
          id: "gamba",
          kind: "project",
          title: "Gamba",
          context: "2 sessions",
          status: "ready",
          href: "/projects/gamba/board",
          projectId: "gamba",
          issueIdentifier: null,
        },
        {
          id: "thread:1",
          kind: "session",
          title: "Chat",
          context: "Gamba",
          status: "active",
          href: "/projects/gamba/workspaces/1",
          projectId: "gamba",
          issueIdentifier: null,
        },
      ],
      [
        {
          id: "issue:gamba:GAM-20",
          kind: "issue",
          title: "GAM-20 · Floating preview surfaces",
          context: "Gamba",
          status: "In Progress",
          href: "/projects/gamba/board/issues/GAM-20",
          projectId: "gamba",
          issueIdentifier: "GAM-20",
        },
      ],
    );
    expect(merged.map((r) => r.kind)).toEqual(["project", "issue", "session"]);
  });

  it("indexes flat-nav project.sessions and overflowSessions", () => {
    const tree = [
      project({
        workspaces: [],
        sessions: [
          session({
            id: "thread:11",
            title: "GAM-20 · Floating surfaces",
            href: "/projects/gamba/workspaces/11",
            issueIdentifier: "GAM-20",
          }),
        ],
        overflowSessions: [
          session({
            id: "thread:12",
            title: "Hidden overflow chat",
            href: "/projects/gamba/workspaces/12",
            workspaceId: null,
          }),
        ],
      }),
    ];

    expect(buildSidebarSearchResults(tree, "floating").map((r) => r.id)).toEqual([
      "thread:11",
    ]);
    expect(buildSidebarSearchResults(tree, "overflow").map((r) => r.id)).toEqual([
      "thread:12",
    ]);
    expect(buildSidebarSearchResults(tree, "gam-20").map((r) => r.id)).toContain(
      "thread:11",
    );
  });

  it("does not match project loadState or kind tokens alone", () => {
    const tree = [
      project({
        title: "Gamba",
        sessions: [session({ id: "thread:1", title: "Alpha" })],
        workspaces: [],
      }),
    ];

    expect(buildSidebarSearchResults(tree, "re").map((r) => r.kind)).toEqual([]);
    expect(buildSidebarSearchResults(tree, "project").map((r) => r.kind)).toEqual([]);
    // Project title match also surfaces child sessions whose context includes the project name.
    expect(buildSidebarSearchResults(tree, "gamba").map((r) => r.kind)).toEqual([
      "project",
      "session",
    ]);
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

  it("loads issue results across projects for the search query", async () => {
    vi.useFakeTimers();
    vi.mocked(listIssues).mockImplementation(async (slug) => {
      if (slug === "gamba") {
        return [
          {
            id: "1",
            identifier: "GAM-20",
            projectSlug: "gamba",
            status: "In Progress",
            title: "Floating preview surfaces",
            description: null,
            priority: null,
            position: 0,
            labels: [],
            blockedBy: [],
            assignee: null,
            creator: null,
            url: null,
            branchName: null,
            createdAt: "2026-07-18T00:00:00.000Z",
            updatedAt: "2026-07-18T00:00:00.000Z",
            attachments: [],
          },
        ];
      }
      return [];
    });

    render(
      <SidebarSearchLauncher
        open
        tree={[project({ id: "gamba", projectSlug: "gamba", title: "Gamba", workspaces: [] })]}
        onOpenChange={() => {}}
        onOpenNode={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search projects and sessions…"), {
        target: { value: "floating" },
      });
      await vi.advanceTimersByTimeAsync(250);
    });

    vi.useRealTimers();

    expect(
      await screen.findByRole("option", { name: /GAM-20 · Floating preview surfaces/i }),
    ).toBeInTheDocument();
    expect(listIssues).toHaveBeenCalledWith("gamba", { search: "floating" });
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
});
