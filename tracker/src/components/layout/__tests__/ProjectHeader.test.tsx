import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ProjectHeader } from "@/components/layout/ProjectHeader";
import type { Issue } from "@/types/issue";

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
      <ProjectHeader projectSlug="macro-markets" view="board" trackerKind="github" pollingActive={pollingActive} />
    </MemoryRouter>,
  );
}

describe("ProjectHeader polling indicator", () => {
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
        <ProjectHeader projectSlug="macro-markets" view="board" trackerKind="local" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Polling active")).toBeNull();
    expect(screen.queryByLabelText("Polling paused (window not focused)")).toBeNull();
  });

  it("passes header quick-create issues to the creation callback", async () => {
    const user = userEvent.setup();
    const onIssueCreated = vi.fn();

    render(
      <MemoryRouter>
        <ProjectHeader
          projectSlug="macro-markets"
          view="board"
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
