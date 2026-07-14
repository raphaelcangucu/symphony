import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applySidebarFilterAction,
  SidebarFiltersMenu,
} from "@/components/layout/sidebar/SidebarFiltersMenu";
import { initTestI18n } from "@/i18n/testUtils";
import {
  defaultSidebarPreferences,
  type SidebarPreferences,
} from "@/lib/sidebarPreferences";
import type { SidebarSessionNode } from "@/types/sidebar";

function preferences(overrides: Partial<SidebarPreferences> = {}): SidebarPreferences {
  const defaults = defaultSidebarPreferences();
  return {
    ...defaults,
    expandedProjectIds: ["acme"],
    expandedWorkspaceIds: ["workspace:main"],
    revealedProjectIds: ["acme"],
    revealedWorkspaceIds: ["workspace:main"],
    pinnedProjectIds: ["acme"],
    filters: { ...defaults.filters },
    lastReadAtBySession: { "thread:old": "2026-07-10T10:00:00.000Z" },
    ...overrides,
  };
}

function session(
  id: string,
  sessionKind: SidebarSessionNode["sessionKind"] = "chat",
): SidebarSessionNode {
  return {
    kind: "session",
    id,
    projectSlug: "acme",
    workspaceId: "workspace:main",
    sessionKind,
    title: id,
    subtitle: "",
    href: `/projects/acme/workspaces/${id}`,
    statusKind: "active",
    aggregateStatus: "active",
    agentKind: "codex",
    updatedAt: "2026-07-13T10:00:00.000Z",
    threadId: 1,
    issueIdentifier: null,
    archived: false,
    unread: true,
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: false,
  };
}

describe("SidebarFiltersMenu", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("immutably applies sort, group, status, agent, activity and archived choices", () => {
    const original = preferences();
    const sorted = applySidebarFilterAction(original, { type: "sort", value: "name" });
    const grouped = applySidebarFilterAction(sorted, { type: "group", value: "status" });
    const statusAdded = applySidebarFilterAction(grouped, {
      type: "toggle-status",
      value: "active",
    });
    const statusRemoved = applySidebarFilterAction(statusAdded, {
      type: "toggle-status",
      value: "active",
    });
    const agentAdded = applySidebarFilterAction(statusRemoved, {
      type: "toggle-agent",
      value: "claude",
    });
    const agentRemoved = applySidebarFilterAction(agentAdded, {
      type: "toggle-agent",
      value: "claude",
    });
    const active = applySidebarFilterAction(agentRemoved, { type: "toggle-activity" });
    const archived = applySidebarFilterAction(active, { type: "toggle-archived" });

    expect(original.sort).toBe("activity");
    expect(sorted).not.toBe(original);
    expect(grouped.group).toBe("status");
    expect(statusAdded.filters.statuses).toEqual(["active"]);
    expect(statusRemoved.filters.statuses).toEqual([]);
    expect(agentAdded.filters.agents).toEqual(["claude"]);
    expect(agentRemoved.filters.agents).toEqual([]);
    expect(active.filters.activityOnly).toBe(true);
    expect(archived.filters.showArchived).toBe(true);
  });

  it("resets only filter fields and collapses expanded and revealed IDs", () => {
    const filtered = preferences({
      sort: "name",
      group: "workspaceKind",
      filters: {
        statuses: ["active"],
        agents: ["cursor"],
        activityOnly: true,
        showArchived: true,
      },
    });
    const reset = applySidebarFilterAction(filtered, { type: "reset-filters" });
    expect(reset.sort).toBe("name");
    expect(reset.group).toBe("workspaceKind");
    expect(reset.filters).toEqual(defaultSidebarPreferences().filters);
    expect(reset.pinnedProjectIds).toEqual(["acme"]);

    const collapsed = applySidebarFilterAction(filtered, { type: "collapse-all" });
    expect(collapsed.expandedProjectIds).toEqual([]);
    expect(collapsed.expandedWorkspaceIds).toEqual([]);
    expect(collapsed.revealedProjectIds).toEqual([]);
    expect(collapsed.revealedWorkspaceIds).toEqual([]);
  });

  it("marks visible non-execution chats with one timestamp and preserves other reads", () => {
    const timestamp = "2026-07-13T20:00:00.000Z";
    const updated = applySidebarFilterAction(
      preferences(),
      {
        type: "mark-visible-read",
        visibleNodes: [
          session("thread:chat"),
          session("thread:authoring", "authoring"),
          session("exec:ACME-1", "execution"),
        ],
        timestamp,
      },
    );
    expect(updated.lastReadAtBySession).toEqual({
      "thread:old": "2026-07-10T10:00:00.000Z",
      "thread:chat": timestamp,
      "thread:authoring": timestamp,
    });
  });

  it("normalizes malformed preferences before applying an action", () => {
    const next = applySidebarFilterAction(
      {
        version: 1,
        sort: "broken",
        group: null,
        filters: { agents: ["invalid"], statuses: "active" },
      },
      { type: "toggle-agent", value: "codex" },
    );
    expect(next.sort).toBe("activity");
    expect(next.group).toBe("none");
    expect(next.filters.agents).toEqual(["codex"]);
    expect(next.filters.statuses).toEqual([]);
  });

  it("renders accessible localized menu actions and emits one immutable updater", async () => {
    const user = userEvent.setup();
    const updatePreferences = vi.fn();
    const { rerender } = render(
      <SidebarFiltersMenu
        preferences={preferences()}
        visibleNodes={[session("thread:chat")]}
        updatePreferences={updatePreferences}
        now={() => "2026-07-13T20:00:00.000Z"}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Show archived" }));
    expect(updatePreferences).toHaveBeenCalledOnce();
    expect(updatePreferences.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect(
      updatePreferences.mock.calls[0]?.[0](preferences()).filters.showArchived,
    ).toBe(true);

    await initTestI18n("pt-BR");
    rerender(
      <SidebarFiltersMenu
        preferences={preferences()}
        visibleNodes={[]}
        updatePreferences={updatePreferences}
      />,
    );
    expect(screen.getByRole("button", { name: /Filtros/i })).toBeInTheDocument();
  });
});
