import { fireEvent, render, screen } from "@testing-library/react-native";

import type { IssueSummary } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { TasksScreen } from "./TasksScreen";

const issue: IssueSummary = {
  id: "1",
  identifier: "MOB-7",
  displayIdentifier: "MOB-7",
  projectSlug: "symphony",
  title: "Bring Orca workflows",
  description: null,
  status: "In Progress",
  priority: 1,
  position: 1,
  labels: ["mobile"],
  assignee: "Raphael",
  creator: null,
  agentKind: "codex",
  agentGoal: null,
  branchName: "agent/mobile",
  createdAt: "",
  updatedAt: "2026-07-24T02:00:00Z",
};

function renderScreen(props: Partial<React.ComponentProps<typeof TasksScreen>> = {}) {
  const defaults: React.ComponentProps<typeof TasksScreen> = {
    groups: [{ status: "In Progress", tasks: [issue] }],
    query: "",
    loading: false,
    error: null,
    activeStatus: null,
    statuses: ["Todo", "In Progress", "Done"],
    onBack: jest.fn(),
    onCreateTask: jest.fn(),
    onOpenTask: jest.fn(),
    onQueryChange: jest.fn(),
    onRefresh: jest.fn(),
    onStatusChange: jest.fn(),
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <TasksScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("TasksScreen", () => {
  it("renders operational task context and opens issue detail", () => {
    const onOpenTask = jest.fn();
    renderScreen({ onOpenTask });

    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getAllByText("In Progress")).toHaveLength(2);
    expect(screen.getByText("MOB-7")).toBeTruthy();
    expect(screen.getByText("Bring Orca workflows")).toBeTruthy();
    expect(screen.getByText("P1")).toBeTruthy();
    expect(screen.getByText("Raphael")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Open task MOB-7" }));
    expect(onOpenTask).toHaveBeenCalledWith("symphony", "MOB-7");
  });

  it("searches, filters, creates, and retries", () => {
    const onQueryChange = jest.fn();
    const onStatusChange = jest.fn();
    const onCreateTask = jest.fn();
    const onRefresh = jest.fn();
    renderScreen({
      groups: [],
      error: "Offline",
      onQueryChange,
      onStatusChange,
      onCreateTask,
      onRefresh,
    });

    fireEvent.changeText(screen.getByLabelText("Search tasks"), "orca");
    fireEvent.press(screen.getByRole("button", { name: "Filter by In Progress" }));
    fireEvent.press(screen.getByRole("button", { name: "Create task" }));
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    expect(onQueryChange).toHaveBeenCalledWith("orca");
    expect(onStatusChange).toHaveBeenCalledWith("In Progress");
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
