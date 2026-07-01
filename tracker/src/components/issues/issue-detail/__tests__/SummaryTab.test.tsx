import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDevServers, type UseIssueDevServersResult } from "@/hooks/useIssueDevServers";
import { normalizePullRequest } from "@/services/pullRequests";
import type { Issue, IssueDevServer, IssueDevServersResponse } from "@/types/issue";
import type { PullRequestGroup } from "@/types/pull-request";

import { SummaryTab } from "../SummaryTab";

vi.mock("@/hooks/useIssueDevServers", () => ({
  useIssueDevServers: vi.fn(),
}));

const hookActions = {
  refresh: vi.fn(),
  restart: vi.fn(),
  restartServer: vi.fn(),
  start: vi.fn(),
  startServer: vi.fn(),
  stop: vi.fn(),
  stopServer: vi.fn(),
  startTunnel: vi.fn(),
};

describe("SummaryTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const action of Object.values(hookActions)) {
      action.mockResolvedValue(undefined);
    }
  });

  it("renders the ready primary preview link", () => {
    renderSummary(
      response([
        server({ id: 1, slug: "api", status: "ready", url: "http://127.0.0.1:4000", primary: false }),
        server({ id: 2, slug: "web", status: "ready", url: "http://127.0.0.1:5173", primary: true }),
      ]),
    );

    expect(useIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");

    const link = screen.getByRole("link", { name: /^preview$/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("renders preview provisioning status when a server has no ready URL yet", () => {
    renderSummary(response([server({ status: "provisioning", url: null })]));

    expect(screen.getByRole("status")).toHaveTextContent(/^preview provisioning\.\.\.$/i);
    expect(screen.queryByRole("link", { name: /^preview$/i })).not.toBeInTheDocument();
  });

  it("does not expose stale URLs from stopped servers", () => {
    renderSummary(response([server({ status: "stopped", url: "http://127.0.0.1:5173" })]));

    expect(screen.queryByRole("link", { name: /^preview$/i })).not.toBeInTheDocument();
  });

  it("renders consolidated sub-issue pull request chips when lab bundle orchestration is on", () => {
    renderSummary(
      response([]),
      {},
      [
        {
          identifier: "front#549",
          title: "Child task",
          pullRequests: [
            normalizePullRequest({ number: 549, repo: "owner/front", url: "https://x/549" } as never),
          ],
        },
      ],
      true,
    );

    expect(screen.getByText("#549")).toBeInTheDocument();
  });

  it("hides sub-issue pull request chips when lab bundle orchestration is off", () => {
    renderSummary(
      response([]),
      {},
      [
        {
          identifier: "front#549",
          title: "Child task",
          pullRequests: [
            normalizePullRequest({ number: 549, repo: "owner/front", url: "https://x/549" } as never),
          ],
        },
      ],
      false,
    );

    expect(screen.queryByText("#549")).not.toBeInTheDocument();
  });

  it("deduplicates child PRs already linked to the parent", () => {
    const shared = normalizePullRequest({ number: 549, url: "https://x/549" } as never);
    vi.mocked(useIssueDevServers).mockReturnValue({
      data: response([]),
      error: null,
      loading: false,
      ...hookActions,
    });

    render(
      <SummaryTab
        issue={issue()}
        projectSlug="macro-markets"
        pullRequests={[shared]}
        pullRequestChildren={[{ identifier: "front#549", title: null, pullRequests: [shared] }]}
        labBundleChildOrchestration
      />,
    );

    expect(screen.getAllByText("#549")).toHaveLength(1);
  });
});

function renderSummary(
  data: IssueDevServersResponse,
  overrides: Partial<UseIssueDevServersResult> = {},
  pullRequestChildren: PullRequestGroup[] = [],
  labBundleChildOrchestration = false,
) {
  vi.mocked(useIssueDevServers).mockReturnValue({
    data,
    error: null,
    loading: false,
    ...hookActions,
    ...overrides,
  });

  render(
    <SummaryTab
      issue={issue()}
      projectSlug="macro-markets"
      pullRequestChildren={pullRequestChildren}
      labBundleChildOrchestration={labBundleChildOrchestration}
    />,
  );
}

function issue(): Issue {
  return {
    assignee: null,
    blockedBy: [],
    branchName: "feat/mac-1",
    createdAt: "2026-05-30T12:00:00Z",
    creator: "alice",
    description: "Implement the preview chip.",
    id: "1",
    identifier: "MAC-1",
    labels: [],
    position: 1,
    priority: 2,
    projectSlug: "macro-markets",
    status: "Todo",
    title: "Add preview chip",
    updatedAt: "2026-05-30T13:00:00Z",
    url: "https://linear.app/acme/issue/MAC-1/add-preview-chip",
    attachments: [],
  };
}

function response(servers: IssueDevServer[]): IssueDevServersResponse {
  return { available: true, reason: null, servers };
}

function server(overrides: Partial<IssueDevServer> = {}): IssueDevServer {
  return {
    id: 1,
    port: 5173,
    primary: true,
    session_name: "sym-issue-macro-markets-MAC-1-web",
    slug: "web",
    status: "ready",
    url: "http://127.0.0.1:5173",
    working_dir: "tracker",
    ...overrides,
  };
}
