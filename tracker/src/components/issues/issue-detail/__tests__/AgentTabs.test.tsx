import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AgentTabs } from "@/components/issues/issue-detail/AgentTabs";
import type { Issue } from "@/types/issue";

vi.mock("@/hooks/useIssueDocuments", () => ({
  useIssueDocuments: () => ({
    available: true,
    documents: [{ id: "spec", kind: "spec", path: "docs/spec.md", title: "Spec", updatedAt: null }],
    loading: false,
    reason: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/assistant/IssueAuthoringPanel", () => ({
  IssueAuthoringPanel: () => <div data-testid="issue-authoring-panel">Authoring</div>,
}));

vi.mock("@/components/issues/issue-detail/AgentTab", () => ({
  AgentTab: () => <div data-testid="agent-execution-panel">Execution</div>,
}));

const issue: Issue = {
  assignee: null,
  blockedBy: [],
  branchName: "feat/dis-6",
  createdAt: "2026-05-31T00:00:00Z",
  creator: "alice",
  description: "Test",
  id: "6",
  identifier: "DIS-6",
  labels: [],
  position: 1,
  priority: 2,
  projectSlug: "distributionmachine",
  status: "Todo",
  title: "Test issue",
  updatedAt: "2026-05-31T00:00:00Z",
  url: null,
  attachments: [],
  groupLeadIdentifier: null,
  groupMemberIdentifiers: [],
};

describe("AgentTabs documents drawer", () => {
  it("shows documents on the execution section", () => {
    render(
      <MemoryRouter initialEntries={["/issues/DIS-6/agent?agent=execution"]}>
        <AgentTabs issue={issue} projectSlug="distributionmachine" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByTestId("agent-execution-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-authoring-panel")).not.toBeInTheDocument();
  });
});
