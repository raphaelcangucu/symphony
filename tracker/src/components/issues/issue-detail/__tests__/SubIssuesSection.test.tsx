import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { SubIssuesSection } from "@/components/issues/issue-detail/SubIssuesSection";
import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

function execution(identifier: string, status: AgentExecutionStatus): AgentExecution {
  return {
    issueIdentifier: identifier,
    status,
    agentKind: "codex",
    sessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: null,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: null,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
  };
}

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
    parentIdentifier: "ios#2",
    subIssueSummary: null,
    ...overrides,
  };
}

describe("SubIssuesSection", () => {
  it("renders nothing when there are no sub-issues and no summary", () => {
    const { container } = render(<SubIssuesSection subtasks={[]} summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists sub-issues with identifiers and a completed/total badge", () => {
    const subtasks = [
      issue({ identifier: "ios#3", title: "Build the iOS app", status: "Done" }),
      issue({ identifier: "ios#4", title: "NFC read/write", status: "Todo" }),
    ];

    render(
      <SubIssuesSection
        subtasks={subtasks}
        summary={{ total: 4, completed: 1, percentCompleted: 25 }}
      />,
    );

    expect(screen.getByText("Sub-issues")).toBeInTheDocument();
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Build the iOS app")).toBeInTheDocument();
    expect(screen.getByText("ios#3")).toBeInTheDocument();
    expect(screen.getByText("ios#4")).toBeInTheDocument();
  });

  it("derives the completed count from statuses when no summary is provided", () => {
    const subtasks = [
      issue({ identifier: "ios#3", title: "Build", status: "Done" }),
      issue({ identifier: "ios#4", title: "NFC", status: "In Progress" }),
      issue({ identifier: "ios#5", title: "BLE", status: "Done" }),
    ];

    render(<SubIssuesSection subtasks={subtasks} summary={null} />);

    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("opens a sub-issue when its row is clicked", () => {
    const onOpenIssue = vi.fn();
    const subtasks = [issue({ identifier: "ios#3", title: "Build", status: "Done" })];

    render(<SubIssuesSection subtasks={subtasks} summary={null} onOpenIssue={onOpenIssue} />);

    fireEvent.click(screen.getByText("Build"));
    expect(onOpenIssue).toHaveBeenCalledWith("ios#3");
  });

  it("collapses and expands the list", () => {
    const subtasks = [issue({ identifier: "ios#3", title: "Build", status: "Done" })];

    render(<SubIssuesSection subtasks={subtasks} summary={null} />);

    expect(screen.getByText("Build")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sub-issues"));
    expect(screen.queryByText("Build")).not.toBeInTheDocument();
  });

  it("renders a create button when creation is allowed even without sub-issues", () => {
    render(<SubIssuesSection subtasks={[]} summary={null} onCreateSubtask={vi.fn()} />);
    expect(screen.getByRole("button", { name: /create sub-issue/i })).toBeInTheDocument();
  });

  it("flags only the sub-issues with a live agent execution", () => {
    const subtasks = [
      issue({ identifier: "back#287", title: "CAPI Meta Ads", status: "In Progress" }),
      issue({ identifier: "front#541", title: "Meta Pixel", status: "Todo" }),
    ];
    const executions = new Map([["back#287", execution("back#287", "live")]]);

    render(<SubIssuesSection subtasks={subtasks} summary={null} executions={executions} />);

    expect(screen.getByTitle("Agent: Live")).toBeInTheDocument();
    expect(screen.queryAllByTitle(/^Agent:/)).toHaveLength(1);
  });

  it("creates a sub-issue from the inline form", async () => {
    const onCreateSubtask = vi.fn().mockResolvedValue(true);
    render(<SubIssuesSection subtasks={[]} summary={null} onCreateSubtask={onCreateSubtask} />);

    fireEvent.click(screen.getByRole("button", { name: /create sub-issue/i }));
    fireEvent.change(screen.getByPlaceholderText("Sub-issue title"), {
      target: { value: "  New child  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateSubtask).toHaveBeenCalledWith("New child");
  });
});
