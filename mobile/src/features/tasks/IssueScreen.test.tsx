import { fireEvent, render, screen } from "@testing-library/react-native";

import type { IssueComment, IssueSummary, PullRequest } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssueScreen } from "./IssueScreen";

const issue: IssueSummary = {
  id: "1",
  identifier: "MOB-7",
  displayIdentifier: "MOB-7",
  projectSlug: "symphony",
  title: "Bring Dev10x workflows",
  description: "Complete the operational mobile experience.",
  status: "In Progress",
  priority: 1,
  position: 1,
  labels: ["mobile", "dev10x"],
  assignee: "Raphael",
  creator: "Raphael",
  agentKind: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
  agentGoal: "Ship mobile parity",
  branchName: "agent/mobile",
  createdAt: "",
  updatedAt: "2026-07-29T12:00:00Z",
};

const comments: IssueComment[] = [
  {
    id: "c1",
    body: "Continue from the task screen.",
    author: "Raphael",
    kind: "comment",
    createdAt: "2026-07-29T12:05:00Z",
    updatedAt: "2026-07-29T12:05:00Z",
  },
  {
    id: "workpad-1",
    body: "## Codex Workpad\n\n- [x] Navigation\n- [x] PR health\n- [ ] Visual review\n\nImplementation is in progress.",
    author: "Codex",
    kind: "workpad",
    createdAt: "2026-07-29T11:00:00Z",
    updatedAt: "2026-07-29T11:30:00Z",
  },
];

const pullRequest: PullRequest = {
  number: 418,
  title: "feat(mobile): task navigation",
  url: null,
  state: "open",
  repo: "dev10x/symphony",
  origin: "auto",
  isDraft: false,
  merged: false,
  headRef: "codex/vin-3",
  baseRef: "main",
  author: "Raphael",
  mergeable: "mergeable",
  checksState: "success",
  pipelines: [],
  statuses: [],
  conversation: [],
  baseBehindBy: 0,
};

function renderScreen(props: Partial<React.ComponentProps<typeof IssueScreen>> = {}) {
  const defaults: React.ComponentProps<typeof IssueScreen> = {
    issue,
    comments,
    blockers: [],
    subtasks: [],
    loading: false,
    error: null,
    evidenceCount: 0,
    saving: false,
    dispatching: false,
    onBack: jest.fn(),
    onAddComment: jest.fn(),
    onDispatch: jest.fn(),
    onGoalAction: jest.fn(),
    onCreateSubtask: jest.fn(),
    onCreateSession: jest.fn(),
    onOpenDiff: jest.fn(),
    onOpenEvidence: jest.fn(),
    onOpenFiles: jest.fn(),
    onOpenPreview: jest.fn(),
    onOpenPullRequest: jest.fn(),
    onOpenRelatedTask: jest.fn(),
    onOpenSession: jest.fn(),
    onOpenTerminal: jest.fn(),
    onRefresh: jest.fn(),
    onSave: jest.fn(),
    pullRequests: [],
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <IssueScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("IssueScreen", () => {
  it("switches among the five focused task tabs while keeping task identity visible", () => {
    renderScreen();

    for (const tab of ["Summary", "PR", "Comments", "Evidence", "Sessions"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeTruthy();
    }
    expect(screen.getByText("MOB-7")).toBeTruthy();
    expect(screen.getByText("Task summary")).toBeTruthy();

    fireEvent.press(screen.getByRole("tab", { name: "Comments" }));

    expect(screen.getByText("MOB-7")).toBeTruthy();
    expect(screen.getByText("Task comments")).toBeTruthy();
    expect(screen.queryByText("Task summary")).toBeNull();
  });

  it("renders live pull request data in the PR tab", () => {
    renderScreen({ pullRequests: [pullRequest] });

    fireEvent.press(screen.getByRole("tab", { name: "PR" }));

    expect(screen.getByText("PR #418")).toBeTruthy();
    expect(screen.getByText("feat(mobile): task navigation")).toBeTruthy();
  });

  it("renders the task as a calm read-oriented summary with focused actions", () => {
    const onOpenEvidence = jest.fn();
    renderScreen({ evidenceCount: 2, onOpenEvidence });

    expect(screen.getByText("MOB-7")).toBeTruthy();
    expect(screen.getByText("Bring Dev10x workflows")).toBeTruthy();
    expect(screen.queryByLabelText("Task title")).toBeNull();
    expect(screen.queryByLabelText("Task description")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save task" })).toBeNull();
    expect(screen.getByText("Ship mobile parity")).toBeTruthy();
    expect(screen.getByText(/gpt-5\.6-sol/)).toBeTruthy();
    expect(screen.getByText(/high/)).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.getByText("mobile · dev10x")).toBeTruthy();
    expect(screen.getByText(/Implementation is in progress/)).toBeTruthy();
    expect(screen.getByText("2 of 3 complete")).toBeTruthy();
    expect(screen.queryByText("Continue from the task screen.")).toBeNull();
    expect(screen.getByRole("button", { name: "Open session" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More task actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull();
    expect(screen.getByText("2 durable runs")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open evidence" }));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });

  it("keeps operational controls secondary and gives comments clear authorship", () => {
    const onAddComment = jest.fn();
    const onDispatch = jest.fn();
    const onGoalAction = jest.fn();
    renderScreen({ onAddComment, onDispatch, onGoalAction });

    fireEvent.press(screen.getByRole("button", { name: "More task actions" }));
    fireEvent.press(screen.getByRole("button", { name: "Continue agent" }));
    fireEvent.press(screen.getByRole("button", { name: "Pause goal" }));
    expect(onDispatch).toHaveBeenCalledWith("continue_work");
    expect(onGoalAction).toHaveBeenCalledWith("pause");

    fireEvent.press(screen.getByRole("tab", { name: "Comments" }));
    expect(screen.getByText("Raphael")).toBeTruthy();
    expect(screen.getByText("Jul 29, 12:05")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("New comment"), "Ready for review");
    fireEvent.press(screen.getByRole("button", { name: "Add comment" }));
    expect(onAddComment).toHaveBeenCalledWith("Ready for review");
  });

  it("navigates blockers and subtasks and creates a child task", () => {
    const onOpenRelatedTask = jest.fn();
    const onCreateSubtask = jest.fn();
    renderScreen({
      blockers: [
        {
          identifier: "MOB-4",
          title: "Pair host",
          status: "In Progress",
          relationType: "blocked_by",
        },
      ],
      subtasks: [{ ...issue, id: "2", identifier: "MOB-8", title: "Stream approvals" }],
      onOpenRelatedTask,
      onCreateSubtask,
    });

    fireEvent.press(screen.getByRole("button", { name: "Open blocker MOB-4" }));
    fireEvent.press(screen.getByRole("button", { name: "Open subtask MOB-8" }));
    expect(onOpenRelatedTask).toHaveBeenNthCalledWith(1, "MOB-4");
    expect(onOpenRelatedTask).toHaveBeenNthCalledWith(2, "MOB-8");

    fireEvent.changeText(screen.getByLabelText("New subtask title"), "Handle questions");
    fireEvent.press(screen.getByRole("button", { name: "Create subtask" }));
    expect(onCreateSubtask).toHaveBeenCalledWith("Handle questions");
  });

  it("does not infer comparison actions from task text or subtasks", () => {
    renderScreen({
      issue: {
        ...issue,
        description: "Create six independent validation tasks.",
      },
      subtasks: [{ ...issue, id: "2", identifier: "MOB-8", title: "Session validation" }],
    });

    expect(screen.queryByRole("button", { name: "Run comparison" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open comparison" })).toBeNull();
  });
});
