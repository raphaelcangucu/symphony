import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityPage } from "../ObservabilityPage";
import type { AgentExecution } from "@/types/agent-execution";
import type { PrMonitorObservability, RuntimeObservability } from "@/types/observability";
import type { Project } from "@/types/project";

let runtimes: RuntimeObservability[];
let projects: Project[];
let prMonitor: PrMonitorObservability | null;
let executions: Map<string, AgentExecution>;

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

vi.mock("@/hooks/useAgentExecutions", () => ({
  useAgentExecutions: () => ({ executions, refetch: vi.fn() }),
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

function goalExecution(issueIdentifier: string, objective: string): AgentExecution {
  return {
    issueIdentifier,
    status: "live",
    agentKind: "codex",
    model: "gpt-5.4",
    sessionId: "sess-1",
    executionSessionId: null,
    lastEvent: "turn_started",
    lastMessage: "working",
    lastEventAt: null,
    turnCount: 2,
    runtimeSeconds: 120,
    startedAt: null,
    retryAttempt: 0,
    error: null,
    goal: {
      kind: "goal",
      source: "native",
      objective,
      status: "active",
      capabilities: [],
      tokenBudget: null,
      tokensUsed: null,
      timeUsedSeconds: null,
      updatedAt: null,
    },
    longRunning: true,
    longRunningKind: "goal",
    longRunningLabel: "Pursuing goal",
    tokens: null,
  };
}

describe("ObservabilityPage", () => {
  beforeEach(() => {
    runtimes = [macroRuntime];
    projects = [macroProject];
    prMonitor = prMonitorData;
    executions = new Map();
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
    expect(screen.getByRole("link", { name: /open session 508/i })).toHaveAttribute(
      "href",
      "/projects/macro-markets/workspaces?exec=508&surface=autonomous",
    );
    expect(screen.getByRole("link", { name: /open issue details 508/i })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/508",
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

    expect(await screen.findByText("508")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Project"), "xip");

    expect(screen.queryByText("508")).not.toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("pauses a running session directly", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByText("508");
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

    await screen.findByText("508");
    await userEvent.click(screen.getByRole("button", { name: /new thread/i }));

    expect(dispatchIssueAgentMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /new thread/i }));

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
      "/projects/macro-markets/board/issues/510/sessions?surface=autonomous",
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

  it("shows the native goal an agent is pursuing in the sessions table", async () => {
    executions = new Map([["508", goalExecution("508", "Ship the i18n migration")]]);

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByText("508");
    expect(screen.getByText("Ship the i18n migration")).toBeInTheDocument();
  });

  it("shows agent and model badges for a running session", async () => {
    executions = new Map([["508", goalExecution("508", "Ship the i18n migration")]]);

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByText("508");
    expect(screen.getByRole("columnheader", { name: /agent \/ model/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "gpt-5.4" })).toBeInTheDocument();
  });

  it("nests child runs under their coordinating parent", async () => {
    const parent = {
      ...macroRuntime.running[0],
      issueIdentifier: "601",
      sessionId: "p",
      bundleRole: "parent" as const,
      childIdentifiers: ["602", "603"],
    };
    const childA = {
      ...macroRuntime.running[0],
      issueIdentifier: "602",
      sessionId: "ca",
      bundleRole: "child" as const,
      parentIdentifier: "601",
      repo: "macro/be",
    };
    const childB = {
      ...macroRuntime.running[0],
      issueIdentifier: "603",
      sessionId: "cb",
      bundleRole: "child" as const,
      parentIdentifier: "601",
      repo: "macro/fe",
    };
    runtimes = [{ ...macroRuntime, counts: { running: 3, retrying: 0 }, running: [parent, childA, childB] }];

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("601")).toBeInTheDocument();
    expect(screen.getByText("602")).toBeInTheDocument();
    expect(screen.getByText("603")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /child runs/i }));

    expect(screen.queryByText("602")).not.toBeInTheDocument();
    expect(screen.queryByText("603")).not.toBeInTheDocument();
    expect(screen.getByText("601")).toBeInTheDocument();
  });

  it("nests waiting subagents under their coordinator with a waiting badge", async () => {
    const parent = {
      ...macroRuntime.running[0],
      issueIdentifier: "701",
      sessionId: "p",
      status: "live" as const,
      bundleRole: "standalone" as const,
    };
    const liveChild = {
      ...macroRuntime.running[0],
      issueIdentifier: "702",
      sessionId: "c-live",
      status: "live" as const,
      bundleRole: "child" as const,
      parentIdentifier: "701",
      repo: "macro/be",
    };
    const waitingChild = {
      ...macroRuntime.running[0],
      issueIdentifier: "703",
      sessionId: null,
      status: "waiting" as const,
      bundleRole: "subagent" as const,
      parentIdentifier: "701",
      repo: "macro/fe",
      startedAt: null,
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    runtimes = [
      { ...macroRuntime, counts: { running: 2, retrying: 0 }, running: [parent, liveChild, waitingChild] },
    ];

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("701")).toBeInTheDocument();
    // The gated subagent is drillable (clickable) and badged as waiting.
    expect(screen.getByText("703")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();

    // Collapsing the parent hides both the live and waiting subagents.
    await userEvent.click(screen.getByRole("button", { name: /child runs/i }));
    expect(screen.queryByText("703")).not.toBeInTheDocument();
    expect(screen.queryByText("702")).not.toBeInTheDocument();
    expect(screen.getByText("701")).toBeInTheDocument();
  });

  it("shows the parent coordinator tokens with a consolidated total on hover", async () => {
    const parent = {
      ...macroRuntime.running[0],
      issueIdentifier: "601",
      sessionId: "p",
      bundleRole: "parent" as const,
      childIdentifiers: ["602", "603"],
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 100 },
    };
    const childA = {
      ...macroRuntime.running[0],
      issueIdentifier: "602",
      sessionId: "ca",
      bundleRole: "child" as const,
      parentIdentifier: "601",
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 30 },
    };
    const childB = {
      ...macroRuntime.running[0],
      issueIdentifier: "603",
      sessionId: "cb",
      bundleRole: "child" as const,
      parentIdentifier: "601",
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 70 },
    };
    runtimes = [{ ...macroRuntime, counts: { running: 3, retrying: 0 }, running: [parent, childA, childB] }];

    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    await screen.findByText("601");

    const tokenCell = screen.getByTitle("Coordinator: 100 · Children: 100 · Total: 200");
    expect(tokenCell).toBeInTheDocument();
    expect(tokenCell).toHaveTextContent("100");
  });

  it("links each runtime summary card to the project board", async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>,
    );

    const boardLink = await screen.findByRole("link", { name: /macro-markets/i });
    expect(boardLink).toHaveAttribute("href", "/projects/macro-markets/board");
  });
});
