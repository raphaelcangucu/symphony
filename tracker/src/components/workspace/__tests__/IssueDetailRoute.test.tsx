import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDetailRoute } from "@/components/workspace/IssueDetailRoute";
import { getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

vi.mock("@/services/issues", () => ({ getIssue: vi.fn() }));
vi.mock("@/services/comments", () => ({ listComments: vi.fn().mockResolvedValue([]), createComment: vi.fn() }));
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

function renderAt(path: string) {
  return render(
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
    </MemoryRouter>,
  );
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
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders an issue already present in the workspace without fetching", async () => {
    workspaceValue.issues = [sampleIssue];

    renderAt("/projects/x/board/issues/ABC-1");

    expect(await screen.findByText("Deep linkable issue")).toBeInTheDocument();
    expect(getIssue).not.toHaveBeenCalled();
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
