import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueSessionsTab } from "@/components/issues/issue-detail/IssueSessionsTab";
import { listAssistantThreads } from "@/services/assistantThreads";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

vi.mock("@/hooks/useArchiveChat", () => ({
  useArchiveChat: () => ({ archiving: false, archiveChat: vi.fn() }),
}));

vi.mock("@/components/sessions/StartIssueSessionDialog", () => ({
  StartIssueSessionDialog: () => null,
}));

vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: vi.fn(),
}));

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: vi.fn(),
}));

const issue = {
  identifier: "GAM-23",
  title: "Investigar envio incorreto de BR em vez de MX para SoftSwiss v2",
  agentKind: "codex" as const,
} satisfies Pick<Issue, "identifier" | "title" | "agentKind">;

const executionThread = {
  id: 8082,
  scope: "issue_execution",
  agentKind: "codex" as const,
  requestedModel: null,
  requestedEffort: null,
  resolvedModel: null,
  resolvedEffort: null,
  projectSlug: "gamba",
  projectName: "Gamba",
  issueIdentifier: "GAM-23",
  workspacePath: null,
  labels: [],
  needsReview: false,
  title: "Run · GAM-23 · Investigar envio incorreto de BR em vez de MX para SoftSwiss v2",
  status: "active",
  preview: null,
  updatedAt: "2026-07-26T16:43:21Z",
};

describe("IssueSessionsTab open session e2e", () => {
  beforeEach(() => {
    vi.mocked(listAssistantThreads).mockReset();
    vi.mocked(listAssistantThreads).mockResolvedValue([executionThread]);
  });

  it("opens the persisted orchestrator session on the workspaces route", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter
        initialEntries={["/projects/gamba/board/issues/GAM-23/sessions"]}
      >
        <Routes>
          <Route
            path="/projects/gamba/board/issues/:identifier/sessions"
            element={
              <IssueSessionsTab
                issue={issue as Issue}
                projectSlug="gamba"
              />
            }
          />
          <Route
            path="/projects/gamba/workspaces/:threadId"
            element={<div>Opened execution session</div>}
          />
          <Route
            path="/projects/gamba/workspaces"
            element={<div>Workspaces list only</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", { name: /Open autonomous run GAM-23/i }),
    );

    expect(await screen.findByText("Opened execution session")).toBeInTheDocument();
    expect(screen.queryByText("Workspaces list only")).not.toBeInTheDocument();
  });

  it("still opens the session when live execution has no session id", async () => {
    const user = userEvent.setup();
    const liveWithoutSessionId = {
      issueIdentifier: "GAM-23",
      status: "live",
      agentKind: "codex",
      sessionId: null,
      executionSessionId: null,
      lastEvent: null,
      lastMessage: null,
      lastEventAt: "2026-07-26T16:43:21Z",
      turnCount: 0,
      runtimeSeconds: null,
      startedAt: "2026-07-26T16:43:21Z",
      retryAttempt: 0,
      error: null,
      goal: null,
      longRunning: false,
      longRunningKind: null,
      longRunningLabel: null,
      tokens: null,
    } satisfies AgentExecution;

    render(
      <MemoryRouter
        initialEntries={["/projects/gamba/board/issues/GAM-23/sessions"]}
      >
        <Routes>
          <Route
            path="/projects/gamba/board/issues/:identifier/sessions"
            element={
              <IssueSessionsTab
                issue={issue as Issue}
                projectSlug="gamba"
                execution={liveWithoutSessionId}
              />
            }
          />
          <Route
            path="/projects/gamba/workspaces/:threadId"
            element={<div>Opened execution session</div>}
          />
          <Route
            path="/projects/gamba/workspaces"
            element={<div>Workspaces list only</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(listAssistantThreads).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: expect.arrayContaining(["issue_execution"]),
        }),
      ),
    );

    await user.click(
      await screen.findByRole("button", { name: /Open autonomous run GAM-23/i }),
    );

    expect(await screen.findByText("Opened execution session")).toBeInTheDocument();
    expect(screen.queryByText("Workspaces list only")).not.toBeInTheDocument();
  });

  it("does not offer a same-page Open issue link that looks like open-session", async () => {
    render(
      <MemoryRouter
        initialEntries={["/projects/gamba/board/issues/GAM-23/sessions"]}
      >
        <Routes>
          <Route
            path="/projects/gamba/board/issues/:identifier/sessions"
            element={
              <IssueSessionsTab
                issue={issue as Issue}
                projectSlug="gamba"
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: /Open autonomous run GAM-23/i });
    expect(
      screen.queryByRole("link", { name: /Open issue GAM-23/i }),
    ).not.toBeInTheDocument();
  });
});
