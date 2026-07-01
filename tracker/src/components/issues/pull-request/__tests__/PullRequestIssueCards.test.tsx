import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PullRequestIssueCards } from "@/components/issues/pull-request/PullRequestIssueCards";
import * as service from "@/services/pullRequests";
import type { PullRequest } from "@/types/pull-request";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/pullRequests");

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 303,
    title: "Configure shared markets foundation",
    url: "https://github.com/clouapp/back/pull/303",
    state: "open",
    repo: "clouapp/back",
    origin: "auto",
    rawState: "OPEN",
    isDraft: false,
    merged: false,
    headRef: "feat/510",
    baseRef: "homolog",
    author: "bot",
    createdAt: null,
    updatedAt: null,
    mergedAt: null,
    mergeable: null,
    checksState: "FAILURE",
    pipelines: [
      {
        name: "CI",
        url: null,
        jobs: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE", url: null, startedAt: null, completedAt: null }],
      },
    ],
    statuses: [],
    conversation: [],
    baseBehindBy: null,
    monitor: null,
    ...overrides,
  };
}

describe("PullRequestIssueCards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders remove control for linked PRs", async () => {
    vi.mocked(service.unlinkPullRequest).mockResolvedValue(undefined);

    render(
      <PullRequestIssueCards
        pullRequests={[makePr()]}
        projectSlug="macro-markets"
        issueIdentifier="MAC-12"
        onRefresh={() => {}}
        supported
        available
      />,
    );

    const remove = screen.getByRole("button", { name: /remove|remover|unlink|desvincular/i });
    await userEvent.click(remove);

    expect(service.unlinkPullRequest).toHaveBeenCalledWith(
      "macro-markets",
      "MAC-12",
      "https://github.com/clouapp/back/pull/303",
    );
  });

  it("shows check rerun controls when PRs have failing checks", () => {
    render(
      <PullRequestIssueCards
        pullRequests={[makePr()]}
        projectSlug="macro-markets"
        issueIdentifier="MAC-12"
        onRefresh={() => {}}
        supported
        available
      />,
    );

    expect(screen.getByRole("button", { name: /re-run|reexecutar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fix with agent|corrigir com agente/i })).toBeInTheDocument();
  });
});
