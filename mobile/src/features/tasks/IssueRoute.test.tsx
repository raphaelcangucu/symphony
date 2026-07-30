import { fireEvent, render, screen } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { useTaskEvidence } from "@/features/evidence/useTaskEvidence";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssueRoute } from "./IssueRoute";
import { useIssueDetail } from "./useIssueDetail";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/api/TrackerClientProvider", () => ({
  useTrackerClient: jest.fn(),
}));
jest.mock("@/api/rpc-tracker-client", () => ({
  createRpcTrackerClient: jest.fn(),
}));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@/features/evidence/useTaskEvidence", () => ({
  useTaskEvidence: jest.fn(),
}));
jest.mock("@/runtime/HostRuntimeProvider", () => ({
  useHostRuntime: jest.fn(),
}));
jest.mock("./useIssueDetail", () => ({ useIssueDetail: jest.fn() }));

const push = jest.fn();
const back = jest.fn();
let issueDetail: ReturnType<typeof useIssueDetail>;

describe("IssueRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push, back } as never);
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ projectSlug: "symphony", identifier: "MOB-7" });
    jest
      .mocked(useTrackerClient)
      .mockReturnValue({} as ReturnType<typeof useTrackerClient>);
    jest.mocked(useHostRuntime).mockReturnValue({
      transport: jest.fn().mockReturnValue(null),
    } as unknown as ReturnType<typeof useHostRuntime>);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTaskEvidence).mockReturnValue({
      records: [
        {
          id: 1,
          runId: "run-mobile-1",
          sessionId: "42",
          status: "passed",
          uiChange: true,
          insertedAt: null,
          provenance: null,
          manifest: {
            issue: "MOB-7",
            generatedAt: null,
            uiChange: true,
            runs: [],
          },
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      cached: false,
    } as ReturnType<typeof useTaskEvidence>);
    issueDetail = {
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
      threads: [
        {
          id: 43,
          scope: "issue_session",
          projectSlug: "symphony",
          projectName: "Symphony",
          issueIdentifier: "MOB-7",
          workspacePath: null,
          title: "Review evidence",
          status: "active",
          preview: null,
          updatedAt: "2026-07-29T16:35:00Z",
          agentKind: "codex",
          needsReview: false,
        },
      ],
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
    } as ReturnType<typeof useIssueDetail>;
    jest.mocked(useIssueDetail).mockReturnValue(issueDetail);
  });

  it("opens the active session and its workspace tools", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Open session" }));
    fireEvent.press(screen.getByRole("button", { name: "More task actions" }));
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

  it("passes durable evidence into the task Evidence tab", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("tab", { name: "Evidence" }));

    expect(screen.getByText("run-mobile-1")).toBeTruthy();
  });

  it("opens an associated chat from the Sessions tab", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("tab", { name: "Sessions" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session 43" }));

    expect(push).toHaveBeenCalledWith("/codex/session/43");
  });

  it("opens the active orchestration instead of dispatching a duplicate agent", () => {
    const dispatch = jest.fn();
    jest.mocked(useIssueDetail).mockReturnValue({
      ...issueDetail,
      issue: {
        ...issueDetail.issue!,
        executionPath: "orchestrator",
      },
      threads: [
        {
          id: 81,
          scope: "issue_execution",
          projectSlug: "symphony",
          projectName: "Symphony",
          issueIdentifier: "MOB-7",
          workspacePath: null,
          title: "MOB-7 execution",
          status: "active",
          preview: null,
          updatedAt: "2026-07-29T16:35:00Z",
          agentKind: "codex",
          needsReview: false,
        },
      ],
      dispatch,
    });

    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Open execution" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/codex/session/81");

    fireEvent.press(screen.getByRole("tab", { name: "Sessions" }));
    expect(
      screen.queryByRole("button", { name: "New task session" }),
    ).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Open session 81" }));
    expect(push).toHaveBeenLastCalledWith("/codex/session/81");
  });

  it("binds a host-scoped task to the transport named by the route", () => {
    const transport = { hostId: "host-alpha" };
    const hostClient = { issue: jest.fn() };
    jest.mocked(useLocalSearchParams).mockReturnValue({
      hostId: "host-alpha",
      projectSlug: "alpha",
      identifier: "ALP-1",
    });
    jest.mocked(useHostRuntime).mockReturnValue({
      transport: jest.fn().mockReturnValue(transport),
    } as unknown as ReturnType<typeof useHostRuntime>);
    jest.mocked(createRpcTrackerClient).mockReturnValue(hostClient as never);

    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    expect(createRpcTrackerClient).toHaveBeenCalledWith(transport);
    expect(useIssueDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        client: hostClient,
        profileId: "host-alpha",
        projectSlug: "alpha",
        identifier: "ALP-1",
      }),
    );
  });

  it("opens host-scoped execution sessions in the unified host chat", () => {
    const transport = { hostId: "host-alpha" };
    jest.mocked(useLocalSearchParams).mockReturnValue({
      hostId: "host-alpha",
      projectSlug: "alpha",
      identifier: "ALP-1",
    });
    jest.mocked(useHostRuntime).mockReturnValue({
      transport: jest.fn().mockReturnValue(transport),
    } as unknown as ReturnType<typeof useHostRuntime>);
    jest.mocked(createRpcTrackerClient).mockReturnValue({} as never);

    render(
      <ThemeProvider colorScheme="dark">
        <IssueRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("tab", { name: "Sessions" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session 43" }));

    expect(push).toHaveBeenCalledWith(
      "/h/host-alpha/chat/43?name=Review%20evidence",
    );
  });
});
