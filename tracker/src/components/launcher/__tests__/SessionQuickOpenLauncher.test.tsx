import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionQuickOpenLauncher } from "@/components/launcher/SessionQuickOpenLauncher";
import * as issuesService from "@/services/issues";
import * as prService from "@/services/projectPullRequests";
import * as branchService from "@/services/projectBranches";
import * as dispatchService from "@/services/issueDispatch";

vi.mock("@/hooks/useAgentExecutions", () => ({
  useAgentExecutions: () => ({ executions: new Map(), refetch: vi.fn() }),
}));

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy, useParams: () => ({ projectSlug: "demo" }) };
});

function renderLauncher() {
  return render(
    <MemoryRouter initialEntries={["/projects/demo/board"]}>
      <SessionQuickOpenLauncher />
    </MemoryRouter>,
  );
}

function renderLauncherAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionQuickOpenLauncher />
    </MemoryRouter>,
  );
}

describe("SessionQuickOpenLauncher", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([]);
    vi.spyOn(prService, "listProjectPullRequests").mockResolvedValue([]);
    vi.spyOn(branchService, "listProjectBranches").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    navigateSpy.mockReset();
  });

  it("opens on mod+j and shows the four source tabs", async () => {
    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");

    expect(await screen.findByRole("tab", { name: /actions/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /issues/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /prs/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /branches/i })).toBeInTheDocument();
  });

  it("selecting an issue navigates to its Agent → Execution deep-link", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: null } as never,
    ]);

    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");
    await userEvent.click(await screen.findByRole("tab", { name: /issues/i }));
    await userEvent.click(await screen.findByText(/Fix login bug/i));

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        "/projects/demo/board/issues/DEMO-12/agent?agent=execution",
      ),
    );
  });

  it("Cmd+click dispatches a background resume instead of navigating", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: null } as never,
    ]);
    const dispatch = vi
      .spyOn(dispatchService, "dispatchIssueAgent")
      .mockResolvedValue({ action: "resume", message: "ok", issue: {} as never });

    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");
    await userEvent.click(await screen.findByRole("tab", { name: /issues/i }));
    await userEvent.keyboard("{Meta>}");
    await userEvent.click(await screen.findByText(/Fix login bug/i));
    await userEvent.keyboard("{/Meta}");

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith("demo", "DEMO-12", { action: "resume" }),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("opens on mod+j from a non-board route", async () => {
    renderLauncherAt("/projects/demo/kb");
    await userEvent.keyboard("{Meta>}j{/Meta}");
    expect(await screen.findByRole("tab", { name: /issues/i })).toBeInTheDocument();
  });
});
