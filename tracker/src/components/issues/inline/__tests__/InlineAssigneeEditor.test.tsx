import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
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
    expect(assigneeButtons[0]?.textContent).toContain(
      i18n.t("issue.inline.assignee.mePrefix", { label: "Raphael Cangucu" }),
    );

    await user.type(screen.getByRole("textbox", { name: /search assignees/i }), "bob");
    expect(screen.getByRole("button", { name: /bob/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /alice/i })).not.toBeInTheDocument();
  });

  it("autosaves the selected assignee when clicking outside", async () => {
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <>
        <InlineAssigneeEditor assignee={null} options={options} onSave={onSave} />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: /unassigned/i }));
    await user.click(await screen.findByRole("button", { name: /bob/i }));
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^outside$/i }));

    expect(onSave).toHaveBeenCalledWith(["U2"]);
  });
});
