import { fireEvent, render, screen } from "@testing-library/react-native";

import type { IssueComment, IssueSummary } from "@/api/contracts";
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
  updatedAt: "",
};

const comments: IssueComment[] = [
  {
    id: "c1",
    body: "Continue from the task screen.",
    author: "Raphael",
    kind: "comment",
    createdAt: "",
    updatedAt: "",
  },
];

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
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <IssueScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("IssueScreen", () => {
  it("renders issue context, comments, and workspace tools", () => {
    const onOpenEvidence = jest.fn();
    renderScreen({ evidenceCount: 2, onOpenEvidence });

    expect(screen.getByText("MOB-7")).toBeTruthy();
    expect(screen.getByDisplayValue("Bring Dev10x workflows")).toBeTruthy();
    expect(screen.getByText("Ship mobile parity")).toBeTruthy();
    expect(screen.getByText("gpt-5.6-sol")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("Continue from the task screen.")).toBeTruthy();
    for (const tool of ["Terminal", "Preview", "Files", "Diff", "Pull request"]) {
      expect(screen.getByRole("button", { name: tool })).toBeTruthy();
    }
    expect(screen.getByText("2 durable runs")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open evidence" }));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });

  it("edits, comments, dispatches, and controls the goal", () => {
    const onSave = jest.fn();
    const onAddComment = jest.fn();
    const onDispatch = jest.fn();
    const onGoalAction = jest.fn();
    renderScreen({ onSave, onAddComment, onDispatch, onGoalAction });

    fireEvent.changeText(screen.getByLabelText("Task title"), "Complete Dev10x parity");
    fireEvent.press(screen.getByRole("button", { name: "Save task" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Complete Dev10x parity" }),
    );

    fireEvent.changeText(screen.getByLabelText("New comment"), "Ready for review");
    fireEvent.press(screen.getByRole("button", { name: "Add comment" }));
    expect(onAddComment).toHaveBeenCalledWith("Ready for review");

    fireEvent.press(screen.getByRole("button", { name: "Continue agent" }));
    fireEvent.press(screen.getByRole("button", { name: "Pause goal" }));
    expect(onDispatch).toHaveBeenCalledWith("continue_work");
    expect(onGoalAction).toHaveBeenCalledWith("pause");
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
