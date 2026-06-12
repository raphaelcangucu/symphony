import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

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
  attachments: [],
};

const formOptions: IssueFormOptions = {
  labels: [],
  assignees: [],
  statuses: ["Todo", "In Progress"],
  agents: [
    { value: "codex", label: "Codex", default: false },
    { value: "claude", label: "Claude", default: false },
  ],
  effectiveAgent: "codex",
};

describe("IssueCreateDialog Codex goal mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateIssue.mockResolvedValue(createdIssue);
    mockGetIssueFormOptions.mockResolvedValue(formOptions);
  });

  it("shows Codex goal mode and sends an edited goal when checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Social login");
    await user.type(screen.getByPlaceholderText("Description"), "Add OAuth and session handling.");

    // Dialog now defaults to "inherit"; select Codex explicitly to reveal goal mode
    await user.click(await screen.findByRole("button", { name: "Codex" }));

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

  it("shows workflow mode for Claude and sends an edited workflow when checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Claude task");
    await user.click(await screen.findByRole("button", { name: "Claude" }));

    const workflowMode = await screen.findByRole("checkbox", { name: /workflow mode/i });
    expect(workflowMode).toBeInTheDocument();

    await user.click(workflowMode);

    const workflow = await screen.findByRole("textbox", { name: /claude workflow/i });
    expect(workflow).toHaveValue(
      "Objective: Claude task\nConstraints: follow existing issue artifacts, specs, and plans when present; verify changes before reporting completion; stop when complete or blocked.",
    );

    await user.clear(workflow);
    await user.type(workflow, "Ship the Claude workflow and verify it.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        agent: "claude",
        goal: "Ship the Claude workflow and verify it.",
      }),
    );
  });

  it("omits goal for unchecked Codex dispatches", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    // Select Codex explicitly first
    await user.click(await screen.findByRole("button", { name: "Codex" }));
    await screen.findByRole("checkbox", { name: /goal mode/i });
    await user.type(screen.getByPlaceholderText("Issue title"), "Regular Codex task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.not.objectContaining({ goal: expect.anything() }),
    );
  });

  it("requires a non-empty goal when Codex goal mode is checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Social login");
    // Select Codex explicitly first to reveal goal mode checkbox
    await user.click(await screen.findByRole("button", { name: "Codex" }));
    await user.click(await screen.findByRole("checkbox", { name: /goal mode/i }));

    const goal = await screen.findByRole("textbox", { name: /codex goal/i });
    await user.clear(goal);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(toast.error).toHaveBeenCalledWith("Goal mode requires a goal.");
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });
});
