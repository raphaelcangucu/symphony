import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineAssigneeEditor } from "../InlineAssigneeEditor";
import type { IssueAssigneeOption } from "@/types/issue";

const options: IssueAssigneeOption[] = [
  { id: "U1", login: "alice", name: "Alice", avatarUrl: null },
  { id: "U2", login: "bob", name: "Bob", avatarUrl: null },
];

describe("InlineAssigneeEditor", () => {
  it("renders the unassigned trigger", () => {
    render(<InlineAssigneeEditor assignee={null} options={options} onSave={async () => true} />);
    expect(screen.getByRole("button", { name: /unassigned/i })).toBeInTheDocument();
  });

  it("renders a current assignee trigger", () => {
    render(<InlineAssigneeEditor assignee="alice" options={options} onSave={async () => true} />);
    expect(screen.getByRole("button", { name: /alice/i })).toBeInTheDocument();
  });
});
