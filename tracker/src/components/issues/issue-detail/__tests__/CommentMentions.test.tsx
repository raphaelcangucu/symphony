import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommentsTab } from "@/components/issues/issue-detail/CommentsTab";

const getIssueFormOptionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", () => ({
  getIssueFormOptions: (...args: unknown[]) => getIssueFormOptionsMock(...args),
}));

describe("CommentsTab mentions", () => {
  beforeEach(() => {
    getIssueFormOptionsMock.mockResolvedValue({
      labels: [],
      statuses: ["Todo"],
      agents: [],
      effectiveAgent: "codex",
      assignees: [
        {
          id: "U1",
          login: "raphael",
          name: "Raphael",
          avatarUrl: null,
        },
      ],
    });
  });

  it("opens mention list when typing @ and inserts selected login", async () => {
    const user = userEvent.setup();

    render(
      <CommentsTab
        comments={[]}
        loading={false}
        error={null}
        projectSlug="gamba"
        onAddComment={vi.fn().mockResolvedValue({ id: "1", body: "", issueIdentifier: "GAM-1" })}
        onUpdateComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hi @ra");

    expect(await screen.findByText("raphael")).toBeInTheDocument();
    await user.click(screen.getByText("raphael"));

    expect(textarea).toHaveValue("Hi @raphael ");
  });
});
