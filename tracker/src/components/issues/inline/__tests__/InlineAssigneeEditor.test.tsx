import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineAssigneeEditor } from "../InlineAssigneeEditor";
import type { IssueAssigneeOption } from "@/types/issue";

vi.mock("@/hooks/useMeIdentities", () => ({
  useMeIdentities: () => ["Raphael Cangucu", "raphael.cangucu"],
}));

const options: IssueAssigneeOption[] = [
  { id: "U1", login: "alice", name: "Alice", avatarUrl: null },
  { id: "U2", login: "bob", name: "Bob", avatarUrl: null },
  {
    id: "U3",
    login: "raphael.cangucu",
    name: "Raphael Cangucu",
    avatarUrl: null,
  },
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

  it("pins the current user first and filters by search", async () => {
    const user = userEvent.setup();
    render(<InlineAssigneeEditor assignee={null} options={options} onSave={async () => true} />);

    await user.click(screen.getByRole("button", { name: /unassigned/i }));
    const assigneeButtons = await screen.findAllByRole("button", { pressed: false });
    expect(assigneeButtons[0]?.textContent).toContain("Eu — Raphael Cangucu");

    await user.type(screen.getByRole("textbox", { name: /search assignees/i }), "bob");
    expect(screen.getByRole("button", { name: /bob/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /alice/i })).not.toBeInTheDocument();
  });
});
