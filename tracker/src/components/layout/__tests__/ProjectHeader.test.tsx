import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ProjectHeader } from "@/components/layout/ProjectHeader";
import type { Issue } from "@/types/issue";
import type { ProjectSyncState } from "@/types/project";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/services/projects", () => ({
  listProjects: vi.fn().mockResolvedValue([]),
}));

const createdIssue: Issue = {
  id: "issue-1",
  identifier: "MAC-1",
  projectSlug: "macro-markets",
  status: "Todo",
  title: "Draft issue",
  description: null,
  priority: null,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: null,
  creator: null,
  url: null,
  branchName: null,
  createdAt: "2026-05-31T00:00:00Z",
  updatedAt: "2026-05-31T00:00:00Z",
  attachments: [],
};

vi.mock("@/components/issues/IssueCreateDialog", () => ({
  IssueCreateDialog: ({
    open,
    onCreated,
    onOpenChange,
  }: {
    open?: boolean;
    onCreated?: (issue: Issue) => void;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onCreated?.(createdIssue);
          onOpenChange?.(false);
        }}
      >
        emit header issue
      </button>
    ) : null,
}));

function renderHeader(pollingActive: boolean) {
  return render(
    <MemoryRouter>
      <ProjectHeader projectSlug="macro-markets" trackerKind="github" pollingActive={pollingActive} />
    </MemoryRouter>,
  );
}

describe("ProjectHeader polling indicator", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the project identity as a project switcher trigger", () => {
    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="distributionmachine" title="Distribution Machine" trackerKind="local" />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "Switch project" });
    expect(trigger).toHaveTextContent("Distribution Machine");
    expect(trigger).toHaveTextContent("distributionmachine");
  });

  it("shows List when on the board view and Board otherwise", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "List" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Board" })).toBeNull();
    unmount();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/list"]}>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Board" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "List" })).toBeNull();
  });

  it("shows the project sessions count in the sessions navigation item", () => {
    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" sessionsCount={22} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Workspaces\s+22/ })).toBeInTheDocument();
  });

  it("labels the knowledge base nav item as KB", () => {
    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "KB" })).toBeInTheDocument();
  });

  it("labels the indicator active when polling is active", () => {
    renderHeader(true);
    expect(screen.getByLabelText("Polling active")).toBeInTheDocument();
    expect(screen.queryByLabelText("Polling paused (window not focused)")).toBeNull();
  });

  it("labels the indicator paused when polling is inactive", () => {
    renderHeader(false);
    expect(screen.getByLabelText("Polling paused (window not focused)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Polling active")).toBeNull();
  });

  it("does not render the indicator for local trackers", () => {
    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Polling active")).toBeNull();
    expect(screen.queryByLabelText("Polling paused (window not focused)")).toBeNull();
  });

  it("shows a sync error badge when background sync is failing", () => {
    const syncState: ProjectSyncState = {
      status: "error",
      lastError: ":remote_unavailable",
      lastPullAt: "2026-06-10T21:00:00Z",
      lastPushAt: "2026-06-10T21:00:00Z",
      lastFullSyncAt: null,
    };

    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="github" syncState={syncState} />
      </MemoryRouter>,
    );

    const badge = screen.getByLabelText("Sync error");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", expect.stringContaining(":remote_unavailable"));
  });

  it("copies a debug-friendly sync error report to the clipboard when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const syncState: ProjectSyncState = {
      status: "error",
      lastError: ":remote_unavailable",
      lastPullAt: "2026-06-10T21:00:00Z",
      lastPushAt: "2026-06-10T21:05:00Z",
      lastFullSyncAt: null,
    };

    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="github" syncState={syncState} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("Sync error"));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Symphony sync error");
    expect(copied).toContain("Project: macro-markets (github)");
    expect(copied).toContain(":remote_unavailable");
    expect(copied).toContain("Last pull: 2026-06-10T21:00:00Z");
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("shows an error toast when copying the sync error fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const syncState: ProjectSyncState = {
      status: "error",
      lastError: "boom",
      lastPullAt: null,
      lastPushAt: null,
      lastFullSyncAt: null,
    };

    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="github" syncState={syncState} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("Sync error"));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  });

  it("does not show the sync error badge when sync is healthy", () => {
    const syncState: ProjectSyncState = {
      status: "idle",
      lastError: null,
      lastPullAt: "2026-06-10T21:00:00Z",
      lastPushAt: "2026-06-10T21:00:00Z",
      lastFullSyncAt: null,
    };

    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="github" syncState={syncState} />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Sync error")).toBeNull();
  });

  it("ignores sync errors for local trackers", () => {
    const syncState: ProjectSyncState = {
      status: "error",
      lastError: "boom",
      lastPullAt: null,
      lastPushAt: null,
      lastFullSyncAt: null,
    };

    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" trackerKind="local" syncState={syncState} />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Sync error")).toBeNull();
  });

  it("passes header quick-create issues to the creation callback", async () => {
    const user = userEvent.setup();
    const onIssueCreated = vi.fn();

    render(
      <MemoryRouter>
        <ProjectHeader
          projectSlug="macro-markets"
          trackerKind="local"
          onIssueCreated={onIssueCreated}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "New issue options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Quick create" }));
    await user.click(screen.getByRole("button", { name: "emit header issue" }));

    expect(onIssueCreated).toHaveBeenCalledWith(createdIssue);
    expect(screen.queryByRole("button", { name: "emit header issue" })).toBeNull();
  });
});
