import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueAssistantRoute } from "@/components/workspace/IssueAssistantRoute";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { IssueDocument } from "@/types/issueDocument";

const projectAssistantPanel = vi.fn(
  ({
    projectSlug,
    view,
    mode,
    onDocumentChanged,
  }: {
    projectSlug?: string;
    view: WorkspaceView;
    mode?: "sheet" | "page";
    onDocumentChanged?: (payload: { identifier: string }) => void;
  }) => (
    <section aria-label="mock project assistant">
      <div>assistant:{projectSlug}</div>
      <div>view:{view}</div>
      <div>mode:{mode}</div>
      <button type="button" onClick={() => onDocumentChanged?.({ identifier: "MAC-1" })}>
        emit matching change
      </button>
      <button type="button" onClick={() => onDocumentChanged?.({ identifier: "MAC-2" })}>
        emit other change
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

let workspaceValue: { projectSlug: string; view: WorkspaceView };

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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectSlug/assistant/new-issue" element={<IssueAssistantRoute />} />
        <Route path="/projects/:projectSlug/assistant/issue/:issueId" element={<IssueAssistantRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IssueAssistantRoute", () => {
  beforeEach(() => {
    workspaceValue = { projectSlug: "macro", view: "board" };
    projectAssistantPanel.mockClear();
    documentViewer.mockClear();
    useIssueDocuments.mockClear();
  });

  it("renders issue authoring with documents for an issue identifier", () => {
    renderAt("/projects/macro/assistant/issue/MAC-1");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.getByText("assistant:macro")).toBeTruthy();
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

  it("renders the new issue authoring placeholder without loading documents", () => {
    renderAt("/projects/macro/assistant/new-issue");

    expect(screen.getByRole("region", { name: "mock project assistant" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "mock documents" })).toBeNull();
    expect(screen.getByText(/Draft documents appear here after the assistant creates or links an issue/i)).toBeTruthy();
    expect(useIssueDocuments).toHaveBeenLastCalledWith({
      projectSlug: "macro",
      identifier: null,
      enabled: false,
      refreshKey: 0,
    });
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
});
