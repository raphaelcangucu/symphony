import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueAssistantRoute } from "@/components/workspace/IssueAssistantRoute";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { IssueDocument } from "@/types/issueDocument";

const projectAssistantPanel = vi.fn(
  ({
    projectSlug,
    issueIdentifier,
    view,
    mode,
    onDraftIssueCreated,
    onIssueCreated,
    onDocumentChanged,
  }: {
    projectSlug?: string;
    issueIdentifier?: string;
    view: WorkspaceView;
    mode?: "sheet" | "page";
    onDraftIssueCreated?: (issue: { identifier: string }) => void;
    onIssueCreated?: (issue: { identifier: string; threadId?: number | null }) => void;
    onDocumentChanged?: (payload: { identifier: string }) => void;
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
    </section>
  ),
);

const documentViewer = vi.fn(
  ({
    projectSlug,
    identifier,
    documents,
    available,
    reason,
  }: {
    projectSlug: string;
    identifier: string;
    documents: IssueDocument[];
    available: boolean;
    reason: string | null;
  }) => (
    <section aria-label="mock documents">
      <div>documents:{projectSlug}:{identifier}</div>
      <div>available:{String(available)}</div>
      <div>reason:{reason ?? "none"}</div>
      <div>count:{documents.length}</div>
    </section>
  ),
);

const useIssueDocuments = vi.fn(
  ({
    projectSlug,
    identifier,
    enabled,
    refreshKey,
  }: {
    projectSlug: string;
    identifier: string | null;
    enabled?: boolean;
    refreshKey?: number;
  }) => ({
    documents: [
      {
        id: `doc-${refreshKey ?? 0}`,
        kind: "spec" as const,
        path: "docs/superpowers/specs/MAC-1.md",
        title: `Spec ${refreshKey ?? 0}`,
        updatedAt: null,
      },
    ],
    available: Boolean(projectSlug && identifier && enabled),
    reason: null,
    loading: false,
    refetch: vi.fn(),
  }),
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

let workspaceValue: {
  agentExecutions: ReadonlyMap<string, AgentExecution>;
  projectSlug: string;
  view: WorkspaceView;
};

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: Parameters<typeof projectAssistantPanel>[0]) => projectAssistantPanel(props),
}));

vi.mock("@/components/assistant/DocumentViewer", () => ({
  DocumentViewer: (props: Parameters<typeof documentViewer>[0]) => documentViewer(props),
}));

vi.mock("@/hooks/useIssueDocuments", () => ({
  useIssueDocuments: (args: Parameters<typeof useIssueDocuments>[0]) => useIssueDocuments(args),
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
    workspaceValue = { agentExecutions: new Map(), projectSlug: "macro", view: "board" };
    projectAssistantPanel.mockClear();
    documentViewer.mockClear();
    useIssueDocuments.mockClear();
  });

  it("renders issue authoring with documents for an issue identifier", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.getByText("assistant:macro")).toBeTruthy();
    expect(screen.getByText("issue:MAC-1")).toBeTruthy();
    expect(screen.getByText("view:board")).toBeTruthy();
    expect(screen.getByText("mode:page")).toBeTruthy();
    expect(screen.getByRole("region", { name: "mock documents" })).toBeTruthy();
    expect(screen.getByText("documents:macro:MAC-1")).toBeTruthy();
    expect(useIssueDocuments).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      identifier: "MAC-1",
      enabled: true,
      refreshKey: 0,
    });
  });

  it("shows active long-running goal status on the issue assistant route", () => {
    workspaceValue = {
      ...workspaceValue,
      agentExecutions: new Map([["MAC-1", execution]]),
    };

    renderAt("/projects/macro/assistant/issue/MAC-1");

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Pursuing goal")).toBeTruthy();
  });

  it("renders the new issue authoring placeholder without loading documents", () => {
    renderAt("/projects/macro/assistant/new-issue");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.getByText("issue:none")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "mock documents" })).toBeNull();
    expect(screen.getByText(/Draft documents appear here after the assistant creates or links an issue/i)).toBeTruthy();
    expect(useIssueDocuments).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      identifier: null,
      enabled: false,
      refreshKey: 0,
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

  it("refreshes documents only when the changed identifier matches the open issue", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    expect(useIssueDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ identifier: "MAC-1", refreshKey: 0 }),
    );

    act(() => {
      screen.getByRole("button", { name: "emit other change" }).click();
    });

    expect(useIssueDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ identifier: "MAC-1", refreshKey: 0 }),
    );

    act(() => {
      screen.getByRole("button", { name: "emit matching change" }).click();
    });

    expect(useIssueDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ identifier: "MAC-1", refreshKey: 1 }),
    );
  });

  it("normalizes issue identifiers when matching document change events", () => {
    renderAt("/projects/macro/assistant/issue/508");

    expect(useIssueDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ identifier: "508", refreshKey: 0 }),
    );

    act(() => {
      screen.getByRole("button", { name: "emit normalized change" }).click();
    });

    expect(useIssueDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ identifier: "508", refreshKey: 1 }),
    );
  });
});
