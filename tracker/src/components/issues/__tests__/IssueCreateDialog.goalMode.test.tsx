import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { i18n } from "@/i18n";
import { createIssue, getIssueFormOptions } from "@/services/issues";
import type { Issue, IssueFormOptions } from "@/types/issue";
import { fallbackCatalogBundle } from "@/lib/assistantSettings";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const fetchAssistantCatalogBundleMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", () => ({
  createIssue: vi.fn(),
  getIssueFormOptions: vi.fn(),
}));

vi.mock("@/services/assistant", () => ({
  fetchAssistantCatalogBundle: (...args: unknown[]) => fetchAssistantCatalogBundleMock(...args),
}));

const mockCreateIssue = vi.mocked(createIssue);
const mockGetIssueFormOptions = vi.mocked(getIssueFormOptions);

function catalogBundle() {
  const bundle = fallbackCatalogBundle();
  bundle.agents = [
    { ...mockAssistantCodexCatalog },
    ...bundle.agents.filter((agent) => agent.agent !== "codex"),
  ];
  return bundle;
}

async function selectAgent(user: ReturnType<typeof userEvent.setup>, kind: "codex" | "claude") {
  const inheritLabel = i18n.t("issue.create.inherit", {
    agent: i18n.t("issue.sessionLog.agentLabels.codex"),
  });
  const trigger = await screen.findByRole("button", { name: inheritLabel });
  await user.click(trigger);
  const itemLabel = i18n.t(`issue.sessionLog.agentLabels.${kind}`);
  await user.click(await screen.findByRole("menuitemradio", { name: itemLabel }));
}

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
    fetchAssistantCatalogBundleMock.mockResolvedValue(catalogBundle());
  });

  it("shows Codex goal mode and sends an edited goal when checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Social login");
    await user.type(screen.getByPlaceholderText("Description"), "Add OAuth and session handling.");

    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());
    await selectAgent(user, "codex");

    const goalMode = await screen.findByRole("checkbox", { name: /goal mode/i });
    expect(goalMode).toBeInTheDocument();

    await user.click(goalMode);

    const goal = await screen.findByRole("textbox", {
      name: i18n.t("issue.create.goalAria", {
        agent: i18n.t("issue.sessionLog.agentLabels.codex"),
        term: i18n.t("issue.create.terms.goal"),
      }),
    });
    expect(goal).toHaveValue(
      [
        i18n.t("issue.create.goal.objective", { objective: "Social login" }),
        i18n.t("issue.create.goal.context", { details: "Add OAuth and session handling." }),
        i18n.t("issue.create.goal.constraints"),
      ].join("\n"),
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

  it("shows goal mode for Claude and sends an edited goal when checked", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Issue title"), "Claude task");
    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());
    await selectAgent(user, "claude");

    const goalMode = await screen.findByRole("checkbox", { name: /goal mode/i });
    expect(goalMode).toBeInTheDocument();

    await user.click(goalMode);

    const goal = await screen.findByRole("textbox", {
      name: i18n.t("issue.create.goalAria", {
        agent: i18n.t("issue.sessionLog.agentLabels.claude"),
        term: i18n.t("issue.create.terms.goal"),
      }),
    });
    expect(goal).toHaveValue(
      [
        i18n.t("issue.create.goal.objective", { objective: "Claude task" }),
        i18n.t("issue.create.goal.constraints"),
      ].join("\n"),
    );

    await user.clear(goal);
    await user.type(goal, "Ship the Claude goal and verify it.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalled());
    expect(mockCreateIssue).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        agent: "claude",
        goal: "Ship the Claude goal and verify it.",
      }),
    );
  });

  it("omits goal for unchecked Codex dispatches", async () => {
    const user = userEvent.setup();

    render(<IssueCreateDialog projectSlug="macro-markets" open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());
    await selectAgent(user, "codex");
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
    await waitFor(() => expect(fetchAssistantCatalogBundleMock).toHaveBeenCalled());
    await selectAgent(user, "codex");
    await user.click(await screen.findByRole("checkbox", { name: /goal mode/i }));

    const goal = await screen.findByRole("textbox", {
      name: i18n.t("issue.create.goalAria", {
        agent: i18n.t("issue.sessionLog.agentLabels.codex"),
        term: i18n.t("issue.create.terms.goal"),
      }),
    });
    await user.clear(goal);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(toast.error).toHaveBeenCalledWith(
      i18n.t("issue.create.goalModeRequired", {
        termCapitalized: "Goal",
        term: i18n.t("issue.create.terms.goal"),
      }),
    );
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });
});
