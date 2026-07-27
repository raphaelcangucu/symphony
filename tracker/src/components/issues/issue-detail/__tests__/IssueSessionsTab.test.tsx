import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueSessionsTab } from "@/components/issues/issue-detail/IssueSessionsTab";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useArchiveChat", () => ({
  useArchiveChat: () => ({ archiving: false, archiveChat: vi.fn() }),
}));

vi.mock("@/hooks/useIssueSessions", () => ({
  useIssueSessions: () => ({
    executionSession: {
      issueIdentifier: "MAC-510",
      title: "Shared order book",
      agentKind: "codex",
      status: "paused",
      bucket: "active",
      lastEventAt: "2026-07-04T00:00:00Z",
      turnCount: 3,
      runtimeSeconds: 120,
      startedAt: "2026-07-04T00:00:00Z",
      goalObjective: null,
      execution: { status: "paused", executionSessionId: 99 },
    },
    executionSessions: [
      {
        issueIdentifier: "MAC-510",
        title: "Shared order book",
        agentKind: "codex",
        status: "paused",
        bucket: "active",
        lastEventAt: "2026-07-04T00:00:00Z",
        turnCount: 3,
        runtimeSeconds: 120,
        startedAt: "2026-07-04T00:00:00Z",
        goalObjective: null,
        execution: { status: "paused", executionSessionId: 99 },
      },
    ],
    chatSessions: [
      {
        id: 12,
        scope: "issue_session",
        agentKind: "codex",
        projectSlug: "macro-markets",
        projectName: "Macro Markets",
        issueIdentifier: "MAC-510",
        title: "Build pass 1",
        status: "active",
        preview: null,
        updatedAt: "2026-07-04T01:00:00Z",
      },
      {
        id: 3,
        scope: "issue",
        agentKind: "codex",
        projectSlug: "macro-markets",
        projectName: "Macro Markets",
        issueIdentifier: "MAC-510",
        title: "Issue plan draft",
        status: "active",
        preview: null,
        updatedAt: "2026-07-03T12:00:00Z",
      },
    ],
    isLoading: false,
    error: null,
    resumePending: false,
    refetch: vi.fn(),
    resumeExecution: vi.fn(),
  }),
}));

vi.mock("@/components/sessions/StartIssueSessionDialog", () => ({
  StartIssueSessionDialog: () => null,
}));

const issue = {
  identifier: "MAC-510",
  title: "Shared order book",
  agentKind: "codex" as const,
};

describe("IssueSessionsTab", () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("navigates to the project sessions page when opening a session", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <IssueSessionsTab issue={issue as never} projectSlug="macro-markets" />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Open autonomous run MAC-510/i }));
    expect(navigateMock).toHaveBeenCalledWith("/projects/macro-markets/workspaces/99");

    await user.click(screen.getByText("Build pass 1"));
    expect(navigateMock).toHaveBeenCalledWith("/projects/macro-markets/workspaces/12");

    await user.click(screen.getByText("Issue plan draft"));
    expect(navigateMock).toHaveBeenCalledWith("/projects/macro-markets/workspaces?exec=MAC-510");
  });
});
