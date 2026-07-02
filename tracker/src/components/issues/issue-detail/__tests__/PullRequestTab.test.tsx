import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PullRequestTab } from "@/components/issues/issue-detail/PullRequestTab";
import { normalizePullRequest } from "@/services/pullRequests";
import type { Issue } from "@/types/issue";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function issue(): Issue {
  return {
    assignee: null,
    blockedBy: [],
    branchName: null,
    createdAt: "2026-05-30T12:00:00Z",
    creator: null,
    description: "",
    id: "1",
    identifier: "510",
    labels: [],
    position: 1,
    priority: null,
    projectSlug: "macro-markets",
    status: "In Progress",
    title: "Parent",
    updatedAt: "2026-05-30T13:00:00Z",
    url: null,
    attachments: [],
  };
}

describe("PullRequestTab lab gating", () => {
  const childGroups = [
    {
      identifier: "MAC-12",
      title: "Shared markets database foundation",
      pullRequests: [
        normalizePullRequest({
          number: 303,
          title: "Configure shared markets foundation",
          url: "https://github.com/clouapp/back/pull/303",
          repo: "clouapp/back",
        } as never),
      ],
    },
  ];

  it("hides sub-issue PR section when lab bundle orchestration is off", () => {
    render(
      <PullRequestTab
        issue={issue()}
        projectSlug="macro-markets"
        pullRequests={[]}
        pullRequestChildren={childGroups}
        labBundleChildOrchestration={false}
        supported
        available
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );

    expect(screen.queryByText(/pull requests das subtarefas|sub-issue pull requests/i)).not.toBeInTheDocument();
    expect(screen.queryByText("MAC-12")).not.toBeInTheDocument();
  });

  it("shows sub-issue PR section when lab bundle orchestration is on", () => {
    render(
      <PullRequestTab
        issue={issue()}
        projectSlug="macro-markets"
        pullRequests={[]}
        pullRequestChildren={childGroups}
        labBundleChildOrchestration
        supported
        available
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText(/pull requests das subtarefas|sub-issue pull requests/i)).toBeInTheDocument();
    expect(screen.getByText("MAC-12")).toBeInTheDocument();
    expect(screen.getByText(/configure shared markets foundation/i)).toBeInTheDocument();
  });
});
