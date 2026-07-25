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

    fireEvent.changeText(screen.getByLabelText("Task title"), "Complete Orca parity");
    fireEvent.changeText(screen.getByLabelText("Task description"), "Finish operational tools");
    fireEvent.changeText(screen.getByLabelText("Agent goal"), "Ship the complete mobile app");
    fireEvent.press(screen.getByRole("button", { name: "Select status In Progress" }));
    fireEvent.press(screen.getByRole("button", { name: "Create task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Complete Orca parity",
      description: "Finish operational tools",
      status: "In Progress",
      agent: "codex",
      goal: "Ship the complete mobile app",
    });
  });
});
