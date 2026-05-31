import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { createIssue, getIssueFormOptions } from "@/services/issues";
import type { Issue, IssueFormOptions } from "@/types/issue";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/services/issues", () => ({
  createIssue: vi.fn(),
  getIssueFormOptions: vi.fn(),
}));

const mockCreateIssue = vi.mocked(createIssue);
const mockGetIssueFormOptions = vi.mocked(getIssueFormOptions);

const createdIssue: Issue = {
  id: "issue-1",
  identifier: "MAC-1",
  projectSlug: "macro-markets",
  status: "Todo",
  title: "Social login",
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

const formOptions: IssueFormOptions = {
  labels: [],
  assignees: [],
  statuses: ["Todo", "In Progress"],
  agents: [
    { value: "codex", label: "Codex", default: true },
    { value: "claude", label: "Claude", default: false },
  ],
};

describe("IssueCreateDialog Codex goal mode", () => {
  beforeEach(() => {
    mockCreateIssue.mockResolvedValue(createdIssue);
    mockGetIssueFormOptions.mockResolvedValue(formOptions);
  });

  it("shows Codex goal mode and sends an edited goal when checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Social login");
    await user.type(screen.getByPlaceholderText("Description"), "Add OAuth and session handling.");

    const goalMode = await screen.findByRole("checkbox", { name: /goal mode/i });
    expect(goalMode).toBeInTheDocument();

    await user.click(goalMode);

    const goal = await screen.findByRole("textbox", { name: /codex goal/i });
    expect(goal).toHaveValue(
      "Objective: Social login\nContext: Add OAuth and session handling.\nConstraints: follow existing issue artifacts, specs, and plans when present; verify changes before reporting completion; stop when complete or blocked.",
    );

    await user.clear(goal);
    await user.type(goal, "Ship the OAuth login flow and verify it.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        agent: "codex",
        goal: "Ship the OAuth login flow and verify it.",
      }),
    );
  });

  it("hides goal mode for Claude and omits goal from the payload", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await screen.findByRole("button", { name: "Claude" });
    await user.click(screen.getByRole("button", { name: "Claude" }));
    expect(screen.queryByRole("checkbox", { name: /goal mode/i })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Issue title"), "Claude task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.not.objectContaining({ goal: expect.anything() }),
    );
  });

  it("omits goal for unchecked Codex dispatches", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await screen.findByRole("checkbox", { name: /goal mode/i });
    await user.type(screen.getByPlaceholderText("Issue title"), "Regular Codex task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.not.objectContaining({ goal: expect.anything() }),
    );
  });
});
