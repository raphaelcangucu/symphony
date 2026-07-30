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
      title: "Complete Dev10x mobile",
      description: "Finish operational tools",
      status: "In Progress",
      agent: "codex",
      model: null,
      effort: null,
      goal: "Ship the complete mobile app",
    });
  });

  it("offers no comparison product mode and creates one ordinary top-level task", () => {
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

    expect(screen.queryByRole("button", { name: "Dev10x comparison" })).toBeNull();
    expect(screen.queryByText("Official high matrix")).toBeNull();

    fireEvent.changeText(screen.getByLabelText("Task title"), "Build the Dev10x landing");
    fireEvent.changeText(screen.getByLabelText("Task description"), "Create the site.");
    fireEvent.press(screen.getByRole("button", { name: "Create task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Build the Dev10x landing",
      description: "Create the site.",
      status: "Backlog",
      agent: "codex",
      model: null,
      effort: null,
      goal: null,
    });
  });

  it("persists the selected ordinary task agent, model, and effort", () => {
    const onSubmit = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <CreateTaskScreen
          catalog={{
            defaultAgent: "codex",
            agents: [
              {
                agent: "codex",
                agentLabel: "Codex",
                defaultModel: "gpt-5.6-sol",
                models: [
                  {
                    model: "gpt-5.6-sol",
                    label: "GPT-5.6 Sol",
                    efforts: [{ effort: "high", label: "High" }],
                  },
                ],
              },
              {
                agent: "claude",
                agentLabel: "Claude",
                defaultModel: "claude-opus-5",
                models: [
                  {
                    model: "claude-opus-5",
                    label: "Opus 5",
                    efforts: [{ effort: "high", label: "High" }],
                  },
                ],
              },
            ],
          }}
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

    fireEvent.changeText(screen.getByLabelText("Task title"), "Claude session task");
    fireEvent.press(screen.getByRole("button", { name: "Select agent Claude" }));
    fireEvent.press(screen.getByRole("button", { name: "Select model Opus 5" }));
    fireEvent.press(screen.getByRole("button", { name: "Select effort High" }));
    fireEvent.press(screen.getByRole("button", { name: "Create task" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude",
        model: "claude-opus-5",
        effort: "high",
      }),
    );
  });
});
