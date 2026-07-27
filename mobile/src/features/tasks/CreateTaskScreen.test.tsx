import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { CreateTaskScreen } from "./CreateTaskScreen";

describe("CreateTaskScreen", () => {
  it("selects project/status and submits a new task with an optional agent goal", () => {
    const onSubmit = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <CreateTaskScreen
          error={null}
          initialAgent="codex"
          loading={false}
          onBack={jest.fn()}
          onProjectChange={jest.fn()}
          onSubmit={onSubmit}
          projectSlug="symphony"
          projects={[
            { id: "1", slug: "symphony", name: "Symphony" },
            { id: "2", slug: "api", name: "API" },
          ]}
          statuses={["Todo", "In Progress"]}
          submitting={false}
        />
      </ThemeProvider>,
    );

    fireEvent.changeText(screen.getByLabelText("Task title"), "Complete Dev10x mobile");
    fireEvent.changeText(screen.getByLabelText("Task description"), "Finish operational tools");
    fireEvent.changeText(screen.getByLabelText("Agent goal"), "Ship the complete mobile app");
    fireEvent.press(screen.getByRole("button", { name: "Select status In Progress" }));
    fireEvent.press(screen.getByRole("button", { name: "Create task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      taskKind: "standard",
      title: "Complete Dev10x mobile",
      description: "Finish operational tools",
      status: "In Progress",
      agent: "codex",
      goal: "Ship the complete mobile app",
    });
  });

  it("shows the fixed high matrix and creates only a Dev10x comparison parent", () => {
    const onSubmit = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <CreateTaskScreen
          error={null}
          initialAgent="codex"
          loading={false}
          onBack={jest.fn()}
          onProjectChange={jest.fn()}
          onSubmit={onSubmit}
          projectSlug="dev10x"
          projects={[{ id: "1", slug: "dev10x", name: "Dev10x" }]}
          statuses={["Backlog"]}
          submitting={false}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Dev10x comparison" }));

    for (const label of [
      "Session · GPT-5.6 Sol · High",
      "Session · Grok 4.5 · High",
      "Session · Opus 5 · High",
      "Orchestrator · GPT-5.6 Sol · High",
      "Orchestrator · Grok 4.5 · High",
      "Orchestrator · Opus 5 · High",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    fireEvent.changeText(screen.getByLabelText("Task title"), "Build the Dev10x landing");
    fireEvent.changeText(screen.getByLabelText("Task description"), "Create and compare the site.");
    fireEvent.press(screen.getByRole("button", { name: "Create comparison task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      taskKind: "comparison",
      title: "Build the Dev10x landing",
      description: "Create and compare the site.",
      status: "Backlog",
      agent: "codex",
      goal: null,
    });
  });
});
