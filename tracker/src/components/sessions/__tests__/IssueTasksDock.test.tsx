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
import {
  issueWorkspaceScope,
  threadWorkspaceScope,
  workspaceScopesEqual,
  type WorkspaceScope,
} from "@/lib/workspaceScope";
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
const ISSUE_SCOPE = issueWorkspaceScope("macro-markets", "510");
const THREAD_SCOPE = threadWorkspaceScope(
  "macro-markets",
  8076,
  "/workspaces/macro-markets/flaky-pipe",
);

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
  const open = workspaceScopesEqual(dockControls.openScope, ISSUE_SCOPE);

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
              onTasksToggle={() => dockControls.toggleTasks(ISSUE_SCOPE)}
            />
            {open ? (
              <IssueTasksDock
                scope={ISSUE_SCOPE}
                splitContainerRef={splitContainerRef}
                fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen((current) => !current)}
                onClose={() => dockControls.toggleTasks(ISSUE_SCOPE)}
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

  it("toggles open from the toolbar and shows the task checklist without tool activity", async () => {
    const user = userEvent.setup();
    let openScope: WorkspaceScope | null = null;
    const toggleTasks = vi.fn((scope: WorkspaceScope) => {
      openScope = workspaceScopesEqual(openScope, scope) ? null : scope;
    });

    const { rerender } = render(
      <TasksDockHarness dockControls={{ openScope, toggleTasks }} />,
    );

    expect(screen.queryByTestId("tasks-dock")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tasks-dock-toolbar-toggle"));
    expect(toggleTasks).toHaveBeenCalledWith(ISSUE_SCOPE);

    rerender(<TasksDockHarness dockControls={{ openScope: ISSUE_SCOPE, toggleTasks }} />);

    expect(screen.getByTestId("tasks-dock")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Verify branches integrated")).toBeInTheDocument();
    expect(screen.getByText("Remove workspace clones")).toBeInTheDocument();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    expect(screen.queryByText("shell")).not.toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("closes from the dock header button", async () => {
    const user = userEvent.setup();
    const toggleTasks = vi.fn();

    render(<TasksDockHarness dockControls={{ openScope: ISSUE_SCOPE, toggleTasks }} />);

    await user.click(screen.getByRole("button", { name: "Close tasks panel" }));
    expect(toggleTasks).toHaveBeenCalledWith(ISSUE_SCOPE);
  });

  it("shows the empty state when the session has no tasks", () => {
    render(
      <TasksDockHarness
        dockControls={{ openScope: ISSUE_SCOPE, toggleTasks: vi.fn() }}
        tasks={null}
        tools={EMPTY_TOOLS}
      />,
    );

    expect(screen.getByText("No agent tasks for this session yet.")).toBeInTheDocument();
  });

  it("identifies a thread-scoped dock by its workspace label", () => {
    const splitContainerRef = createRef<HTMLDivElement>();

    render(
      <SessionTasksDockFeedProvider>
        <div ref={splitContainerRef}>
          <IssueTasksDock
            scope={THREAD_SCOPE}
            splitContainerRef={splitContainerRef}
            fullscreen={false}
            onToggleFullscreen={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </SessionTasksDockFeedProvider>,
    );

    expect(screen.getByTestId("tasks-dock")).toHaveAccessibleName("Tasks for flaky-pipe");
    expect(screen.getByText("flaky-pipe")).toBeInTheDocument();
  });
});
