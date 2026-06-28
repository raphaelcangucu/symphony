import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { SubtaskParentCard } from "@/components/board/SubtaskParentCard";
import type { Issue } from "@/types/issue";

function renderInBoard(ui: React.ReactElement, sortableId: string) {
  return render(
    <DndContext>
      <SortableContext items={[sortableId]}>{ui}</SortableContext>
    </DndContext>,
  );
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? "x",
    identifier: overrides.identifier ?? "x",
    projectSlug: "xip",
    status: "Todo",
    title: overrides.title ?? "t",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "",
    updatedAt: "",
    attachments: [],
    groupLeadIdentifier: null,
    groupMemberIdentifiers: [],
    repositoryFullName: null,
    parentIdentifier: null,
    subIssueSummary: null,
    ...overrides,
  };
}

describe("SubtaskParentCard", () => {
  const parent = issue({
    identifier: "2",
    title: "Aplicativo IOS",
    subIssueSummary: { total: 2, completed: 1, percentCompleted: 50 },
  });
  const subtasks = [
    issue({ identifier: "3", title: "NFC", repositoryFullName: "xipcash/ios" }),
    issue({ identifier: "4", title: "BLE", repositoryFullName: "xipcash/android" }),
  ];

  it("shows the subtask count and expands to list subtasks", () => {
    renderInBoard(
      <SubtaskParentCard id="parent:2" issue={parent} subtasks={subtasks} onSelectIssue={() => {}} />,
      "parent:2",
    );

    expect(screen.getByText("2 subtasks")).toBeInTheDocument();
    // Plain click event (not pointer) so the bare DndContext's default sensor
    // doesn't treat the press as a drag and swallow the toggle.
    fireEvent.click(screen.getByTitle("Show subtasks"));
    expect(screen.getByText("NFC")).toBeInTheDocument();
    expect(screen.getByText("BLE")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows the status icon for each subtask", () => {
    const inProgressSubtask = issue({
      identifier: "back#287",
      title: "CAPI Meta Ads",
      status: "In Progress",
    });

    renderInBoard(
      <SubtaskParentCard
        id="parent:2"
        issue={parent}
        subtasks={[inProgressSubtask]}
        onSelectIssue={() => {}}
      />,
      "parent:2",
    );

    fireEvent.click(screen.getByTitle("Show subtasks"));
    expect(screen.getByTitle("In Progress")).toBeInTheDocument();
    expect(screen.getByText("CAPI Meta Ads")).toBeInTheDocument();
    expect(screen.getByText("back#287")).toBeInTheDocument();
  });
});
