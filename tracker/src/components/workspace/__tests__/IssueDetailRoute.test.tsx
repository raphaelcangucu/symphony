import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDetailRoute } from "@/components/workspace/IssueDetailRoute";
import { getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

vi.mock("@/services/issues", () => ({
  getIssue: vi.fn(),
  // SummaryTab loads form options and useIssueUpdater calls these when the
  // editable drawer renders; provide inert mocks so the route tests stay focused
  // on navigation rather than the editor internals.
  getIssueFormOptions: vi
    .fn()
    .mockResolvedValue({ labels: [], assignees: [], statuses: [], agents: [] }),
  moveIssue: vi.fn(),
  updateIssue: vi.fn(),
}));
vi.mock("@/services/comments", () => ({ listComments: vi.fn().mockResolvedValue([]), createComment: vi.fn() }));
// The drawer renders inline editors that resolve the "me" identity via useViewer
// + a network call; stub it so these routing-focused tests don't need a
// ViewerProvider or a live backend.
vi.mock("@/hooks/useMeIdentities", () => ({ useMeIdentities: () => [] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";

const sampleIssue: Issue = {
  id: "issue-1",
  identifier: "ABC-1",
  projectSlug: "x",
  status: "Todo",
  title: "Deep linkable issue",
  description: "Body",
  priority: 1,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: "alice",
  creator: "bob",
  url: null,
  branchName: null,
  createdAt: "2026-05-29T00:00:00Z",
  updatedAt: "2026-05-29T00:00:00Z",
  attachments: [],
  groupLeadIdentifier: null,
  groupMemberIdentifiers: [],
};

let workspaceValue: {
  projectSlug: string;
  view: "board" | "list";
  issues: Issue[];
  agentExecutions: ReadonlyMap<string, never>;
  loading: boolean;
};

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => workspaceValue,
}));

function routesTree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:projectSlug/board"
          element={
            <>
              <div>board base</div>
              <Outlet />
            </>
          }
        >
          <Route path="issues/:identifier" element={<IssueDetailRoute />} />
          <Route path="issues/:identifier/:tab" element={<IssueDetailRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderAt(path: string) {
  return render(routesTree(path));
}

describe("IssueDetailRoute", () => {
  beforeEach(() => {
    workspaceValue = {
      projectSlug: "x",
      view: "board",
      issues: [],
      agentExecutions: new Map<string, never>(),
      loading: false,
    };
    vi.clearAllMocks();
    vi.mocked(getIssue).mockResolvedValue(sampleIssue);
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the cached issue immediately and still refreshes from the server", async () => {
    workspaceValue.issues = [sampleIssue];

    renderAt("/projects/x/board/issues/ABC-1");

    expect(await screen.findByText("Deep linkable issue")).toBeInTheDocument();
    // The full issue is fetched in the background so remote-only data (e.g. Jira
    // attachments) the board list omits gets filled in.
    await waitFor(() => expect(getIssue).toHaveBeenCalledWith("x", "ABC-1"));
  });

  it("fetches the issue only once even as the board list updates underneath", async () => {
    // Reproduces a page refresh: the board list reference churns (realtime
    // upserts, polling) *while* the full issue fetch is still in flight. The
    // fetch must fire exactly once instead of restarting on every update.
    let resolveFetch: (issue: Issue) => void = () => {};
    vi.mocked(getIssue).mockImplementationOnce(
      () =>
        new Promise<Issue>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    workspaceValue.issues = [];
    const { rerender } = renderAt("/projects/x/board/issues/ABC-1");

    await waitFor(() => expect(getIssue).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 3; i += 1) {
      workspaceValue.issues = [{ ...sampleIssue }];
      rerender(routesTree("/projects/x/board/issues/ABC-1"));
    }

    // No extra requests while the first one is still pending.
    expect(getIssue).toHaveBeenCalledTimes(1);

    resolveFetch(sampleIssue);

    expect(await screen.findByText("Deep linkable issue")).toBeInTheDocument();
    expect(getIssue).toHaveBeenCalledTimes(1);
  });

  it("fetches an issue that is not in the workspace list", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce(sampleIssue);

    renderAt("/projects/x/board/issues/ABC-1");

    expect(await screen.findByText("Deep linkable issue")).toBeInTheDocument();
    expect(getIssue).toHaveBeenCalledWith("x", "ABC-1");
  });

  it("redirects to the board base with a toast when the issue is missing", async () => {
    vi.mocked(getIssue).mockRejectedValueOnce(new Error("not found"));

    renderAt("/projects/x/board/issues/NOPE-9");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Issue NOPE-9 was not found"));
    expect(screen.queryByText("Deep linkable issue")).not.toBeInTheDocument();
    expect(screen.getByText("board base")).toBeInTheDocument();
  });

  it("activates the tab named in the URL", async () => {
    workspaceValue.issues = [sampleIssue];

    renderAt("/projects/x/board/issues/ABC-1/comments");

    const commentsTab = await screen.findByRole("tab", { name: /comments/i });
    await waitFor(() => expect(commentsTab).toHaveAttribute("data-state", "active"));
  });

  it("closes the drawer back to the board base on escape", async () => {
    workspaceValue.issues = [sampleIssue];

    renderAt("/projects/x/board/issues/ABC-1");

    expect(await screen.findByText("Deep linkable issue")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Deep linkable issue")).not.toBeInTheDocument());
    expect(screen.getByText("board base")).toBeInTheDocument();
  });
});
