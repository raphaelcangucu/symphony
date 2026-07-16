import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("sidebar utility navigation", () => {
  beforeEach(async () => {
    await initTestI18n("en");
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
