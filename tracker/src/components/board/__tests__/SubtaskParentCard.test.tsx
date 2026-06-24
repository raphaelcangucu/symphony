import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SubtaskParentCard } from "@/components/board/SubtaskParentCard";
import type { Issue } from "@/types/issue";

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

  it("shows the subtask count and expands to list subtasks", async () => {
    render(<SubtaskParentCard issue={parent} subtasks={subtasks} onSelectIssue={() => {}} />);

    expect(screen.getByText("2 subtasks")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /subtask/i }));
    expect(screen.getByText("NFC")).toBeInTheDocument();
    expect(screen.getByText("BLE")).toBeInTheDocument();
  });
});
