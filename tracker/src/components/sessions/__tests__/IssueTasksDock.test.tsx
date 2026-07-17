import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueTasksDock } from "@/components/sessions/IssueTasksDock";
import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import {
  SessionTasksDockContext,
  type SessionTasksDockControls,
} from "@/components/sessions/sessionTasksDockContext";
import {
  SessionTasksDockFeedProvider,
  usePublishSessionTasksDockFeed,
} from "@/components/sessions/sessionTasksDockFeedContext";
import { initTestI18n } from "@/i18n/testUtils";
import type { AssistantToolCall } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/510", reason: null },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
  }),
}));

vi.mock("@/components/agent-activity/ToolActivityTimeline", () => ({
  ToolActivityTimeline: ({ toolCalls }: { toolCalls: AssistantToolCall[] }) => (
    <div data-testid="tool-activity-timeline">
      {toolCalls.map((call, index) => (
        <div key={`${call.name}-${index}`}>{call.name}</div>
      ))}
    </div>
  ),
}));

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "1", text: "Verify branches integrated", status: "completed", source: "plan" },
    { id: "2", text: "Remove workspace clones", status: "in_progress", source: "plan" },
  ],
};

const toolItems: AssistantToolCall[] = [
  {
    id: "tool-1",
    name: "shell",
    status: "complete",
    arguments: { command: "ls" },
    result: {},
  },
  {
    id: "tool-2",
    name: "read_file",
    status: "complete",
    arguments: { path: "README.md" },
    result: {},
  },
];

const EMPTY_TOOLS: AssistantToolCall[] = [];

function FeedPublisher({
  tasks,
  tools,
}: {
  tasks: AgentTaskSnapshot | null;
  tools: readonly AssistantToolCall[];
}) {
  usePublishSessionTasksDockFeed({ tasks, toolItems: tools });
  return null;
}

function TasksDockHarness({
  dockControls,
  tasks = snapshot,
  tools = toolItems,
}: {
  dockControls: SessionTasksDockControls;
  tasks?: AgentTaskSnapshot | null;
  tools?: readonly AssistantToolCall[];
}) {
  const splitContainerRef = createRef<HTMLDivElement>();
  const [fullscreen, setFullscreen] = useState(false);
  const open = dockControls.openIssueIdentifier === "510";

  return (
    <MemoryRouter>
      <SessionTasksDockContext.Provider value={dockControls}>
        <SessionTasksDockFeedProvider>
          <FeedPublisher tasks={tasks} tools={tools} />
          <div ref={splitContainerRef} style={{ width: 1200 }} className="flex">
            <IssueWorkingTreeToolbar
              projectSlug="macro-markets"
              issueIdentifier="510"
              view="board"
              tasksOpen={open}
              onTasksToggle={() => dockControls.toggleTasks("510")}
            />
            {open ? (
              <IssueTasksDock
                issueIdentifier="510"
                splitContainerRef={splitContainerRef}
                fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen((current) => !current)}
                onClose={() => dockControls.toggleTasks("510")}
              />
            ) : null}
          </div>
        </SessionTasksDockFeedProvider>
      </SessionTasksDockContext.Provider>
    </MemoryRouter>
  );
}

describe("IssueTasksDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("toggles open from the toolbar and shows the task checklist plus tool items", async () => {
    const user = userEvent.setup();
    let openIssueIdentifier: string | null = null;
    const toggleTasks = vi.fn((issueIdentifier: string) => {
      openIssueIdentifier = openIssueIdentifier === issueIdentifier ? null : issueIdentifier;
    });

    const { rerender } = render(
      <TasksDockHarness dockControls={{ openIssueIdentifier, toggleTasks }} />,
    );

    expect(screen.queryByTestId("tasks-dock")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tasks-dock-toolbar-toggle"));
    expect(toggleTasks).toHaveBeenCalledWith("510");

    rerender(<TasksDockHarness dockControls={{ openIssueIdentifier: "510", toggleTasks }} />);

    expect(screen.getByTestId("tasks-dock")).toBeInTheDocument();
    expect(screen.getByText("Tasks & tools")).toBeInTheDocument();
    expect(screen.getByText("Verify branches integrated")).toBeInTheDocument();
    expect(screen.getByText("Remove workspace clones")).toBeInTheDocument();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    expect(screen.getByTestId("tool-activity-timeline")).toBeInTheDocument();
    expect(screen.getByText("shell")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("closes from the dock header button", async () => {
    const user = userEvent.setup();
    const toggleTasks = vi.fn();

    render(<TasksDockHarness dockControls={{ openIssueIdentifier: "510", toggleTasks }} />);

    await user.click(screen.getByRole("button", { name: "Close tasks and tools panel" }));
    expect(toggleTasks).toHaveBeenCalledWith("510");
  });

  it("shows empty states when the session has no tasks or tools", () => {
    render(
      <TasksDockHarness
        dockControls={{ openIssueIdentifier: "510", toggleTasks: vi.fn() }}
        tasks={null}
        tools={EMPTY_TOOLS}
      />,
    );

    expect(screen.getByText("No agent tasks for this session yet.")).toBeInTheDocument();
    expect(screen.getByText("No tool activity for this session yet.")).toBeInTheDocument();
  });
});
