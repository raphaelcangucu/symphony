import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueAssistantRoute } from "@/components/workspace/IssueAssistantRoute";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

const projectAssistantPanel = vi.fn(
  ({
    projectSlug,
    issueIdentifier,
    view,
    mode,
    onDraftIssueCreated,
    onIssueCreated,
    onDocumentChanged,
    onKbDocumentReferencesChanged,
    onOpenDocumentPath,
  }: {
    projectSlug?: string;
    issueIdentifier?: string;
    view: WorkspaceView;
    mode?: "sheet" | "page";
    onDraftIssueCreated?: (issue: { identifier: string }) => void;
    onIssueCreated?: (issue: { identifier: string; threadId?: number | null }) => void;
    onDocumentChanged?: (payload: { identifier: string }) => void;
    onKbDocumentReferencesChanged?: (paths: string[]) => void;
    onOpenDocumentPath?: (path: string) => void;
  }) => (
    <section aria-label="mock project assistant">
      <div>assistant:{projectSlug}</div>
      <div>issue:{issueIdentifier ?? "none"}</div>
      <div>view:{view}</div>
      <div>mode:{mode}</div>
      <button type="button" onClick={() => onDocumentChanged?.({ identifier: "MAC-1" })}>
        emit matching change
      </button>
      <button type="button" onClick={() => onDocumentChanged?.({ identifier: "MAC-2" })}>
        emit other change
      </button>
      <button type="button" onClick={() => onDocumentChanged?.({ identifier: "#508" })}>
        emit normalized change
      </button>
      <button type="button" onClick={() => onDraftIssueCreated?.({ identifier: "MAC-7" })}>
        create draft issue
      </button>
      <button type="button" onClick={() => onIssueCreated?.({ identifier: "MAC-8", threadId: 88 })}>
        emit issue created
      </button>
      <button type="button" onClick={() => onKbDocumentReferencesChanged?.(["market/polymarket-omnibus-spec.md"])}>
        emit kb reference
      </button>
      <button type="button" onClick={() => onOpenDocumentPath?.("docs/market/polymarket-omnibus-spec.md")}>
        open kb reference
      </button>
    </section>
  ),
);

const assistantKbDocumentsPanel = vi.fn(
  ({
    projectSlug,
    citedPaths,
    requestedPath,
  }: {
    projectSlug: string;
    citedPaths: string[];
    requestedPath?: string | null;
  }) => (
    <section aria-label="mock kb documents">
      <div>kb-documents:{projectSlug}</div>
      <div>cited:{citedPaths.join(",") || "none"}</div>
      <div>requested:{requestedPath ?? "none"}</div>
    </section>
  ),
);

const execution: AgentExecution = {
  agentKind: "codex",
  error: null,
  goal: {
    kind: "goal",
    source: "native",
    objective: "Ship the issue",
    status: "active",
    capabilities: ["get", "edit", "pause", "resume", "clear"],
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    updatedAt: null,
  },
  issueIdentifier: "MAC-1",
  lastEvent: "notification",
  lastEventAt: "2026-05-31T00:02:00Z",
  lastMessage: "Working",
  longRunning: true,
  longRunningKind: "goal",
  longRunningLabel: "Pursuing goal",
  retryAttempt: 0,
  runtimeSeconds: 42,
  sessionId: "session-1",
  startedAt: "2026-05-31T00:01:00Z",
  status: "live",
  tokens: null,
  turnCount: 1,
};

const issue: Issue = {
  id: "issue-1",
  identifier: "DIS-6",
  projectSlug: "distributionmachine",
  status: "Todo",
  title: "Translate the admin UI",
  description: null,
  priority: null,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: null,
  creator: null,
  url: null,
  branchName: null,
  createdAt: "2026-06-20T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
  attachments: [],
  groupLeadIdentifier: null,
  groupMemberIdentifiers: [],
};

let workspaceValue: {
  agentExecutions: ReadonlyMap<string, AgentExecution>;
  issues: Issue[];
  projectSlug: string;
  view: WorkspaceView;
};

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: Parameters<typeof projectAssistantPanel>[0]) => projectAssistantPanel(props),
}));

vi.mock("@/components/assistant/AssistantKbDocumentsPanel", () => ({
  AssistantKbDocumentsPanel: (props: Parameters<typeof assistantKbDocumentsPanel>[0]) =>
    assistantKbDocumentsPanel(props),
}));

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => workspaceValue,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/projects/:projectSlug/assistant/new-issue" element={<IssueAssistantRoute />} />
        <Route path="/projects/:projectSlug/assistant/issue/:issueId" element={<IssueAssistantRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IssueAssistantRoute", () => {
  beforeEach(() => {
    workspaceValue = { agentExecutions: new Map(), issues: [], projectSlug: "macro", view: "board" };
    projectAssistantPanel.mockClear();
    assistantKbDocumentsPanel.mockClear();
  });

  it("renders issue authoring with the KB documents panel for an issue identifier", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.getByText("assistant:macro")).toBeTruthy();
    expect(screen.getByText("issue:MAC-1")).toBeTruthy();
    expect(screen.getByText("view:board")).toBeTruthy();
    expect(screen.getByText("mode:page")).toBeTruthy();
    expect(screen.getByRole("region", { name: "mock kb documents" })).toBeTruthy();
    expect(assistantKbDocumentsPanel).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      citedPaths: [],
      requestedPath: null,
    });
  });

  it("does not surface orchestrator execution status on the authoring route", () => {
    workspaceValue = {
      ...workspaceValue,
      agentExecutions: new Map([["MAC-1", execution]]),
    };

    renderAt("/projects/macro/assistant/issue/MAC-1");

    // Execution status (including the Execution goal) belongs to the Execution tab, not the
    // authoring assistant route.
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByText("Pursuing goal")).toBeNull();
  });

  it("shows the task title with a link to its issue detail", () => {
    workspaceValue = { ...workspaceValue, issues: [issue], projectSlug: "distributionmachine" };

    renderAt("/projects/distributionmachine/assistant/issue/DIS-6");

    expect(screen.getByText("Translate the admin UI")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open issue details/i })).toHaveAttribute(
      "href",
      "/projects/distributionmachine/board/issues/DIS-6",
    );
  });

  it("renders the new issue authoring placeholder without loading documents", () => {
    renderAt("/projects/macro/assistant/new-issue");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.getByText("issue:none")).toBeTruthy();
    expect(screen.getByRole("region", { name: "mock kb documents" })).toBeTruthy();
    expect(screen.getByText(/Start by asking the assistant to draft an issue/i)).toBeTruthy();
    expect(assistantKbDocumentsPanel).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      citedPaths: [],
      requestedPath: null,
    });
  });

  it("navigates from new issue authoring to the issue assistant route after the issue-created event", () => {
    renderAt("/projects/macro/assistant/new-issue");

    act(() => {
      screen.getByRole("button", { name: "emit issue created" }).click();
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/macro/assistant/issue/MAC-8");
    expect(screen.getByText("issue:MAC-8")).toBeTruthy();
  });

  it("does not navigate from new issue authoring on completed draft tool-call fallback alone", () => {
    renderAt("/projects/macro/assistant/new-issue");

    act(() => {
      screen.getByRole("button", { name: "create draft issue" }).click();
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/macro/assistant/new-issue");
    expect(screen.getByText("issue:none")).toBeTruthy();
  });

  it("passes cited KB references from the chat into the KB panel", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    act(() => {
      screen.getByRole("button", { name: "emit kb reference" }).click();
    });

    expect(assistantKbDocumentsPanel).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      citedPaths: ["market/polymarket-omnibus-spec.md"],
      requestedPath: null,
    });
  });

  it("passes opened KB document paths into the KB panel", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    act(() => {
      screen.getByRole("button", { name: "open kb reference" }).click();
    });

    expect(assistantKbDocumentsPanel).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      citedPaths: [],
      requestedPath: "docs/market/polymarket-omnibus-spec.md",
    });
  });
});
