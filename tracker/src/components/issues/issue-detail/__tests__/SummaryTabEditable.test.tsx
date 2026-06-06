import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import type { Issue, IssueFormOptions } from "@/types/issue";

import { SummaryTab } from "../SummaryTab";

const getIssueFormOptionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: vi.fn(),
}));

vi.mock("@/services/issues", () => ({
  getIssueFormOptions: (...args: unknown[]) => getIssueFormOptionsMock(...args),
}));

const formOptions: IssueFormOptions = {
  labels: [{ id: "L1", name: "bug", color: null }],
  assignees: [{ id: "U1", login: "alice", name: "Alice", avatarUrl: null }],
  statuses: ["Todo", "In Progress", "Done"],
  agents: [],
  effectiveAgent: "codex",
};

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    assignee: null,
    blockedBy: [],
    branchName: null,
    createdAt: "2026-05-30T12:00:00Z",
    creator: "alice",
    description: "Body",
    id: "1",
    identifier: "MAC-1",
    labels: ["bug"],
    position: 1,
    priority: 0,
    projectSlug: "macro-markets",
    status: "Todo",
    title: "Editable issue",
    updatedAt: "2026-05-30T13:00:00Z",
    url: null,
    ...overrides,
  };
}

const editableHandlers = {
  onSaveDescription: async () => true,
  onSaveLabels: async () => true,
  onSaveStatus: async () => true,
  onSavePriority: async () => true,
  onSaveAssignee: async () => true,
};

describe("SummaryTab (editable)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIssueFormOptionsMock.mockResolvedValue(formOptions);
    vi.mocked(useIssueDevServers).mockReturnValue({
      data: null,
      error: null,
      loading: false,
      refresh: vi.fn(),
      restart: vi.fn(),
      restartServer: vi.fn(),
      start: vi.fn(),
      startServer: vi.fn(),
      stop: vi.fn(),
      stopServer: vi.fn(),
      startTunnel: vi.fn(),
    });
  });

  // Regression guard: rendering the full editable sidebar (status + priority +
  // assignee + labels + description editors) used to hang due to an infinite
  // update loop in InlineLabelEditor. A loop would freeze/throw on render.
  it("renders all inline editors without an update loop", async () => {
    render(<SummaryTab issue={issue()} projectSlug="macro-markets" {...editableHandlers} />);

    expect(await screen.findByRole("button", { name: /no priority/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unassigned/i })).toBeInTheDocument();
    await waitFor(() => expect(getIssueFormOptionsMock).toHaveBeenCalledTimes(1));
  });

  it("loads form options exactly once for an editable summary", async () => {
    render(<SummaryTab issue={issue()} projectSlug="macro-markets" {...editableHandlers} />);

    await waitFor(() => expect(getIssueFormOptionsMock).toHaveBeenCalledTimes(1));
    // Settle pending state updates; a loop would keep calling the mock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getIssueFormOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch form options when the summary is read-only", async () => {
    render(<SummaryTab issue={issue()} projectSlug="macro-markets" />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(getIssueFormOptionsMock).not.toHaveBeenCalled();
  });
});
