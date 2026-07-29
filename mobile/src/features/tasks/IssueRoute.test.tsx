import { fireEvent, render, screen } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { useTaskEvidence } from "@/features/evidence/useTaskEvidence";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssueRoute } from "./IssueRoute";
import { useIssueDetail } from "./useIssueDetail";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@/features/evidence/useTaskEvidence", () => ({ useTaskEvidence: jest.fn() }));
jest.mock("./useIssueDetail", () => ({ useIssueDetail: jest.fn() }));

const push = jest.fn();
const back = jest.fn();

describe("IssueRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push, back } as never);
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ projectSlug: "symphony", identifier: "MOB-7" });
    jest.mocked(useTrackerClient).mockReturnValue({} as ReturnType<typeof useTrackerClient>);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTaskEvidence).mockReturnValue({
      records: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      cached: false,
    } as ReturnType<typeof useTaskEvidence>);
    jest.mocked(useIssueDetail).mockReturnValue({
      issue: {
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
      comments: [],
      blockers: [],
      pullRequests: [
        {
          number: 418,
          title: "Task navigation",
          url: null,
          state: "open",
          repo: "dev10x/symphony",
          origin: "auto",
          isDraft: false,
          merged: false,
          headRef: "codex/vin-3",
          baseRef: "main",
          author: null,
          mergeable: "mergeable",
          checksState: "success",
          pipelines: [],
          statuses: [],
          conversation: [],
          baseBehindBy: 0,
        },
      ],
      threadId: 42,
      loading: false,
      error: null,
      saving: false,
      dispatching: false,
      addComment: jest.fn(),
      dispatch: jest.fn(),
      goalAction: jest.fn(),
      refresh: jest.fn(),
      save: jest.fn(),
    });
  });

  it("opens the active session and its workspace tools", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Open session" }));
    fireEvent.press(screen.getByRole("button", { name: "Terminal" }));
    expect(push).toHaveBeenNthCalledWith(1, "/codex/session/42");
    expect(push).toHaveBeenNthCalledWith(2, "/codex/session/42/terminal");
  });

  it("passes live pull request data into the task PR tab", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("tab", { name: "PR" }));

    expect(screen.getByText("PR #418")).toBeTruthy();
  });
});
