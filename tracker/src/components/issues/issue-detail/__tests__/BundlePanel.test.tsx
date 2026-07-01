import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BundlePanel } from "@/components/issues/issue-detail/BundlePanel";
import type { AgentExecution } from "@/types/agent-execution";
import type { ExecutionBundle } from "@/types/bundle";
import type { Issue } from "@/types/issue";

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? "x",
    identifier: overrides.identifier ?? "x",
    projectSlug: "macro-markets",
    status: "Todo",
    title: overrides.title ?? "t",
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "",
    updatedAt: "",
    attachments: [],
    repositoryFullName: null,
    parentIdentifier: null,
    subIssueSummary: null,
    ...overrides,
  };
}

function execution(overrides: Partial<AgentExecution>): AgentExecution {
  return {
    issueIdentifier: overrides.issueIdentifier ?? "x",
    status: overrides.status ?? "idle",
    agentKind: "codex",
    sessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: null,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: null,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
    ...overrides,
  };
}

const bundle: ExecutionBundle = {
  mode: "bundle",
  parent: "MAC-1",
  units: [
    { id: "be", type: "child_run", issue: "MAC-2", repo: "macro/be", produces: ["api"], consumes: [], dependsOn: [], deliverable: "pr" },
    { id: "copy", type: "workpad_task", repo: "macro/app", produces: [], consumes: [], dependsOn: [] },
  ],
  sharedContracts: [{ id: "api", kind: "graphql", ownerUnit: "be", consumers: ["fe"], status: "ready" }],
};

describe("BundlePanel", () => {
  it("renders units, contracts, and repo for a bundle parent", () => {
    const parent = issue({ identifier: "MAC-1", title: "Coordinator" });
    const executions = [
      execution({ issueIdentifier: "MAC-2", parentIdentifier: "MAC-1", bundleRole: "child", unitId: "be", repo: "macro/be", status: "live" }),
    ];

    render(
      <MemoryRouter>
        <BundlePanel issue={parent} bundle={bundle} executions={executions} />
      </MemoryRouter>,
    );

    expect(screen.getByText("be")).toBeInTheDocument();
    expect(screen.getByText("copy")).toBeInTheDocument();
    expect(screen.getByText(/child_run/i)).toBeInTheDocument();
    expect(screen.getByText(/workpad_task/i)).toBeInTheDocument();
    expect(screen.getByText("macro/be")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });

  it("renders nothing for a non-bundle issue", () => {
    const standalone = issue({ identifier: "MAC-9", title: "Solo" });

    const { container } = render(
      <MemoryRouter>
        <BundlePanel issue={standalone} bundle={null} executions={[]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
