import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceArchiveDialog } from "@/components/sessions/WorkspaceArchiveDialog";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { archiveAssistantThread, deleteAssistantThread } from "@/services/assistantThreads";
import type { RecentSession } from "@/types/recents";

vi.mock("@/services/assistantThreads", () => ({
  archiveAssistantThread: vi.fn(),
  deleteAssistantThread: vi.fn(),
}));

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
    threadId: 11,
    status: "active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-02T11:00:00Z",
    ...overrides,
  };
}

describe("WorkspaceArchiveDialog", () => {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    vi.clearAllMocks();
    vi.mocked(archiveAssistantThread).mockResolvedValue({ id: 11 } as never);
    vi.mocked(deleteAssistantThread).mockResolvedValue(undefined);
  });

  function renderDialog(sessions: RecentSession[]) {
    return renderWithI18n(
      <WorkspaceArchiveDialog
        sessions={sessions}
        open
        onOpenChange={onOpenChange}
        onDone={onDone}
      />,
    );
  }

  it("lists only sessions with thread ids and pre-selects them", () => {
    renderDialog([
      session({ id: "a", threadId: 11, title: "One" }),
      session({ id: "b", threadId: null, title: "No thread" }),
      session({ id: "c", threadId: 12, title: "Two" }),
    ]);

    expect(screen.getByText("One")).toBeVisible();
    expect(screen.getByText("Two")).toBeVisible();
    expect(screen.queryByText("No thread")).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it("archives selected sessions", async () => {
    renderDialog([session({ threadId: 11 }), session({ id: "c", threadId: 12, title: "Two" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Archive/i }));

    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(11));
    await waitFor(() => expect(archiveAssistantThread).toHaveBeenCalledWith(12));
    expect(deleteAssistantThread).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requires a second confirmation before permanent delete", async () => {
    renderDialog([session({ threadId: 11 })]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/i }));
    expect(deleteAssistantThread).not.toHaveBeenCalled();
    expect(screen.getByText(/Permanently delete 1 sessions/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Confirm delete/i }));

    await waitFor(() => expect(deleteAssistantThread).toHaveBeenCalledWith(11));
    expect(archiveAssistantThread).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
