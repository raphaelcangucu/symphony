import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import * as service from "@/services/pullRequests";
import type { PullRequest } from "@/types/pull-request";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/pullRequests");

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 509,
    title: "x",
    url: "https://github.com/acme/app/pull/509",
    state: "open",
    rawState: "OPEN",
    isDraft: false,
    merged: false,
    headRef: "feat/508",
    baseRef: "homolog",
    author: "bot",
    createdAt: null,
    updatedAt: null,
    mergedAt: null,
    checksState: null,
    pipelines: [],
    statuses: [],
    conversation: [],
    baseBehindBy: null,
    ...overrides,
  };
}

describe("PullRequestPanel update branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides the button when not behind", () => {
    render(
      <PullRequestPanel
        pullRequest={makePr({ baseBehindBy: 0 })}
        projectSlug="macro-markets"
        issueIdentifier="#508"
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /update branch/i })).toBeNull();
  });

  it("updates and refreshes when behind", async () => {
    vi.mocked(service.updatePullRequestBranch).mockResolvedValue({ updated: true });
    const onRefresh = vi.fn();

    render(
      <PullRequestPanel
        pullRequest={makePr({ baseBehindBy: 1 })}
        projectSlug="macro-markets"
        issueIdentifier="#508"
        onRefresh={onRefresh}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /update branch/i }));

    await waitFor(() =>
      expect(service.updatePullRequestBranch).toHaveBeenCalledWith("macro-markets", "#508", 509),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
