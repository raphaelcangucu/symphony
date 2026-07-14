import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceCleanupDialog } from "@/components/sessions/WorkspaceCleanupDialog";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { removeWorkspaces } from "@/services/worktrees";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

vi.mock("@/services/worktrees", () => ({ removeWorkspaces: vi.fn() }));

function entry(overrides: Partial<WorkspaceInventoryEntry>): WorkspaceInventoryEntry {
  return {
    path: "/ws/demo/DEMO-1",
    displayName: null,
    kind: "issue",
    issueIdentifier: "DEMO-1",
    name: null,
    classification: "orphan",
    reclaimable: true,
    workPresent: false,
    executionStatus: null,
    removable: true,
    sizeBytes: 2048,
    repos: [],
    childWorktrees: [],
    ...overrides,
  };
}

describe("WorkspaceCleanupDialog", () => {
  const onCleaned = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    vi.clearAllMocks();
    vi.mocked(removeWorkspaces).mockResolvedValue([
      { path: "/ws/demo/OLD-1", status: "removed", reason: null },
    ]);
  });

  function renderDialog(entries: WorkspaceInventoryEntry[]) {
    return renderWithI18n(
      <WorkspaceCleanupDialog
        projectSlug="demo"
        entries={entries}
        open
        onOpenChange={onOpenChange}
        onCleaned={onCleaned}
      />,
    );
  }

  it("pre-selects reclaimable orphans and leaves dirty orphans unchecked", () => {
    renderDialog([
      entry({ path: "/ws/demo/OLD-1", issueIdentifier: "OLD-1", reclaimable: true }),
      entry({ path: "/ws/demo/OLD-2", issueIdentifier: "OLD-2", reclaimable: false, workPresent: true }),
    ]);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it("excludes the project workspace and non-removable entries", () => {
    renderDialog([
      entry({ path: "/ws/demo", kind: "project", issueIdentifier: null }),
      entry({ path: "/ws/demo/RUN-1", issueIdentifier: "RUN-1", removable: false }),
      entry({ path: "/ws/demo/OLD-1", issueIdentifier: "OLD-1" }),
    ]);

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("removes the selected paths and reports success", async () => {
    renderDialog([entry({ path: "/ws/demo/OLD-1", issueIdentifier: "OLD-1" })]);

    fireEvent.click(screen.getByRole("button", { name: /Remove selected/i }));

    await waitFor(() => expect(removeWorkspaces).toHaveBeenCalledWith("demo", ["/ws/demo/OLD-1"]));
    await waitFor(() => expect(onCleaned).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables confirmation when nothing is selected", () => {
    renderDialog([entry({ path: "/ws/demo/OLD-2", issueIdentifier: "OLD-2", reclaimable: false })]);

    expect(screen.getByRole("button", { name: /Remove selected/i })).toBeDisabled();
  });
});
