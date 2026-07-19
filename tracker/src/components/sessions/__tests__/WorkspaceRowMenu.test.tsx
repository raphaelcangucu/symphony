import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRowMenu } from "@/components/sessions/WorkspaceRowMenu";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { WorkspaceCard, WorkspaceListItem } from "@/lib/workspaceCards";
import type { RecentSession } from "@/types/recents";
import { MemoryRouter } from "react-router-dom";

function session(overrides: Partial<RecentSession> = {}): RecentSession {
  return {
    id: "chat-1",
    kind: "chat",
    scope: "issue_session",
    agentKind: null,
    projectSlug: "demo",
    projectName: "Demo",
    title: "Spike notes",
    identifier: "DEMO-1",
    threadId: 42,
    status: "active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-02T11:00:00Z",
    ...overrides,
  };
}

function issueCard(overrides: Partial<WorkspaceCard> = {}): WorkspaceListItem {
  const card: WorkspaceCard = {
    key: "issue:DEMO-1",
    section: "active",
    kind: "issue",
    issueIdentifier: "DEMO-1",
    title: "Fix login race",
    sortValue: Date.parse("2026-07-02T11:00:00Z"),
    inventory: null,
    execution: null,
    authoring: null,
    sessions: [session()],
    ...overrides,
  };
  return { kind: "card", key: card.key, sortValue: card.sortValue, card };
}

describe("WorkspaceRowMenu", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("offers archive and delete for issue workspace cards with a thread", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const onDelete = vi.fn();

    renderWithI18n(
      <MemoryRouter>
        <WorkspaceRowMenu
          item={issueCard()}
          issueHref="/projects/demo/board/issues/DEMO-1"
          onOpenSession={vi.fn()}
          onNewSession={vi.fn()}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("menuitem", { name: "Open issue" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Session" })).toBeVisible();

    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith(42);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(42);
  });

  it("hides archive for an active issue_execution primary session but still offers delete", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const onDelete = vi.fn();

    renderWithI18n(
      <MemoryRouter>
        <WorkspaceRowMenu
          item={issueCard({
            sessions: [
              session({
                scope: "issue_execution",
                statusKind: "running",
                title: "Run · DEMO-1",
              }),
            ],
          })}
          issueHref="/projects/demo/board/issues/DEMO-1"
          onOpenSession={vi.fn()}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.queryByRole("menuitem", { name: "Archive" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(42);
  });

  it("offers archive and delete for freeform chat rows", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const chatItem: WorkspaceListItem = {
      kind: "chat",
      key: "chat:7",
      sortValue: Date.parse("2026-07-02T11:00:00Z"),
      session: session({
        id: "chat-7",
        scope: "freeform",
        identifier: null,
        threadId: 7,
        title: "Explore filter",
      }),
    };

    renderWithI18n(
      <MemoryRouter>
        <WorkspaceRowMenu
          item={chatItem}
          issueHref={null}
          onOpenAssistantSession={vi.fn()}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith(7);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(7);
  });
});
