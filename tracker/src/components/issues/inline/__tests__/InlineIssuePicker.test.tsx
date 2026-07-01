import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { InlineIssuePicker } from "@/components/issues/inline/InlineIssuePicker";
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
    repositoryFullName: null,
    parentIdentifier: null,
    subIssueSummary: null,
    ...overrides,
  };
}

const baseProps = {
  title: "Set parent issue",
  placeholder: "No parent",
  searchPlaceholder: "Search issues…",
  emptyLabel: "No matching issues.",
  clearLabel: "Remove parent",
};

describe("InlineIssuePicker", () => {
  it("shows the placeholder when no value is selected", () => {
    render(
      <InlineIssuePicker
        {...baseProps}
        value={null}
        candidates={[issue({ identifier: "ios#2", title: "Parent" })]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("No parent")).toBeInTheDocument();
  });

  it("selects a candidate and excludes the current value from the list", async () => {
    const onSelect = vi.fn().mockResolvedValue(true);
    render(
      <InlineIssuePicker
        {...baseProps}
        value="ios#2"
        candidates={[
          issue({ identifier: "ios#2", title: "Current parent" }),
          issue({ identifier: "ios#5", title: "Another candidate" }),
        ]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("Current parent"));
    fireEvent.click(screen.getByText("Another candidate"));

    expect(onSelect).toHaveBeenCalledWith("ios#5");
  });

  it("clears the value through the inline clear button", async () => {
    const onClear = vi.fn().mockResolvedValue(true);
    render(
      <InlineIssuePicker
        {...baseProps}
        value="ios#2"
        candidates={[issue({ identifier: "ios#2", title: "Current parent" })]}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove parent" }));
    expect(onClear).toHaveBeenCalled();
  });
});
