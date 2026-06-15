import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityPage } from "../ObservabilityPage";
import type { PrMonitorObservability, RuntimeObservability } from "@/types/observability";
import type { Project } from "@/types/project";

let runtimes: RuntimeObservability[];
let projects: Project[];
let prMonitor: PrMonitorObservability | null;

const macroRuntime: RuntimeObservability = {
  runtimeId: "r1",
  label: "WORKFLOW.macromarkets.example.md",
  projectSlug: null,
  trackerKind: "github",
  agentKind: "codex",
  sourceUrl: "http://localhost:4001",
  status: "online",
  reportedAt: new Date().toISOString(),
  counts: { running: 1, retrying: 0 },
  agentTotals: { inputTokens: 1, outputTokens: 2, totalTokens: 3, secondsRunning: 0 },
  rateLimits: null,
  running: [
    {
      issueIdentifier: "508",
      state: "Rework",
      sessionId: "sess-1",
      turnCount: 2,
      lastEvent: "agent_message",
      lastMessage: "working",
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      tokens: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    },
  ],
  retrying: [],
};

const xipRuntime: RuntimeObservability = {
  ...macroRuntime,
  runtimeId: "r2",
  label: "xip",
  projectSlug: "xip",
  running: [{ ...macroRuntime.running[0], issueIdentifier: "9", sessionId: "sess-2" }],
};

const macroProject: Project = {
  id: "p1",
  name: "Macro Markets",
  slug: "macro-markets",
  description: null,
  tracker: { kind: "github", config: {} },
};

vi.mock("@/hooks/useObservability", () => ({
  useObservability: () => ({ runtimes, loading: false }),
}));

vi.mock("@/hooks/usePrMonitorObservability", () => ({
  usePrMonitorObservability: () => ({ data: prMonitor, loading: false }),
}));

vi.mock("@/services/projects", () => ({
  listProjects: vi.fn(() => Promise.resolve(projects)),
}));

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

const prMonitorData: PrMonitorObservability = {
  heartbeat: {
    running: true,
    inFlight: 0,
    tickCount: 4,
    lastTickStartedAt: new Date().toISOString(),
    lastTickFinishedAt: new Date().toISOString(),
    lastTickStatus: "ok",
    lastError: null,
    lastEvaluatedCount: 1,
    intervalMs: 60000,
  },
  evaluations: [
    {
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      prUrl: "https://github.com/acme/app/pull/7",
      lastEvent: "merged",
      lastAction: "moved_to_done",
      autoReworkCount: 0,
      summary: "merged",
      lastCheckedAt: new Date().toISOString(),
      lastActionAt: new Date().toISOString(),
    },
  ],
};

describe("ObservabilityPage", () => {
  beforeEach(() => {
    runtimes = [macroRuntime];
    projects = [macroProject];
    prMonitor = prMonitorData;
    dispatchIssueAgentMock.mockReset();
    dispatchIssueAgentMock.mockResolvedValue({ action: "stop", message: "ok", issue: {} });
  });

  it("renders a runtime card and the global sessions table row", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("macro-markets")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "508" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/508/agent?agent=execution",
    );
    expect(screen.getByText(/online/i)).toBeInTheDocument();
  });

  it("filters running sessions by project", async () => {
    runtimes = [macroRuntime, xipRuntime];
    projects = [macroProject, { ...macroProject, id: "p2", name: "Xip", slug: "xip" }];

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "508" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "9" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Project"), "xip");

    expect(screen.queryByRole("link", { name: "508" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "9" })).toBeInTheDocument();
  });

  it("pauses a running session directly", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByRole("link", { name: "508" });
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith("macro-markets", "508", { action: "stop" }),
    );
  });

  it("requires confirmation before hard resetting a session", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByRole("link", { name: "508" });
    await userEvent.click(screen.getByRole("button", { name: /hard reset/i }));

    expect(dispatchIssueAgentMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /hard reset/i }));

    await waitFor(() =>
      expect(dispatchIssueAgentMock).toHaveBeenCalledWith("macro-markets", "508", { action: "hard_reset" }),
    );
  });

  it("renders the PR monitor heartbeat and evaluation row", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("PR monitor")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/agent?agent=execution",
    );
    expect(screen.getByText("PR merged")).toBeInTheDocument();
  });

  it("shows an offline PR monitor when heartbeat is unavailable", async () => {
    prMonitor = null;

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("PR monitor")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByText("No PR evaluations recorded yet.")).toBeInTheDocument();
  });
});
