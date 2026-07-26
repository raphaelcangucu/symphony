import { fireEvent, render, screen } from "@testing-library/react-native";
import { useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { TasksRoute } from "./TasksRoute";
import { useTasks } from "./useTasks";

jest.mock("expo-router", () => ({ useRouter: jest.fn() }));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("./useTasks", () => ({ useTasks: jest.fn() }));

const push = jest.fn();
const back = jest.fn();

describe("TasksRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push, back } as never);
    jest.mocked(useTrackerClient).mockReturnValue({} as ReturnType<typeof useTrackerClient>);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTasks).mockReturnValue({
      groups: [
        {
          status: "In Progress",
          tasks: [
            {
              id: "1",
              identifier: "MOB-7",
              displayIdentifier: "MOB-7",
              projectSlug: "symphony",
              title: "Bring Orca workflows",
              description: null,
              status: "In Progress",
              priority: 1,
              position: 1,
              labels: [],
              assignee: null,
              creator: null,
              agentKind: "codex",
              agentGoal: null,
              branchName: null,
              createdAt: "",
              updatedAt: "",
            },
          ],
        },
      ],
      statuses: ["In Progress"],
      loading: false,
      refreshing: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it("navigates from the task list to issue detail", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <TasksRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Open task MOB-7" }));
    expect(push).toHaveBeenCalledWith("/codex/issue/symphony/MOB-7");
  });
});
