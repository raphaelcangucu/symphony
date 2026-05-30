import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { WorkspaceFiltersRoute } from "@/components/workspace/WorkspaceFiltersRoute";
import * as viewerService from "@/services/viewer";

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "x", view: "board", knownLogins: ["alice", "bob"] }),
}));

function Harness() {
  const [params] = useSearchParams();
  return (
    <>
      <BoardFiltersTrigger />
      <Outlet />
      <output data-testid="params">{params.toString()}</output>
    </>
  );
}

function renderHarness() {
  vi.spyOn(viewerService, "fetchViewer").mockResolvedValueOnce({
    githubLogin: "octocat",
    name: null,
    avatarUrl: null,
  });

  return render(
    <MemoryRouter initialEntries={["/projects/x/board"]}>
      <ViewerProvider>
        <Routes>
          <Route path="/projects/:projectSlug/board" element={<Harness />}>
            <Route path="filters" element={<WorkspaceFiltersRoute />} />
          </Route>
        </Routes>
      </ViewerProvider>
    </MemoryRouter>,
  );
}

describe("BoardFiltersDrawer (route-driven)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is closed by default and opens via the header trigger navigating to /filters", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/search issues/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));

    expect(await screen.findByPlaceholderText(/search issues/i)).toBeInTheDocument();
  });

  it("debounces the search input into ?q=", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "login" } });
      await vi.advanceTimersByTimeAsync(260);
    });

    expect(screen.getByTestId("params").textContent).toContain("q=login");
    vi.useRealTimers();
  });

  it("applies assignee=me from the dropdown", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
    await userEvent.click(screen.getByText(/^Me$/));

    expect(screen.getByTestId("params").textContent).toContain("assignee=me");
  });

  it("clears all filters but keeps the drawer open", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "x" } });
    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));

    expect(screen.getByTestId("params").textContent).toBe("");
    expect(screen.getByPlaceholderText(/search issues/i)).toBeInTheDocument();
  });

  it("trigger badge reflects the active filter count", async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.change(screen.getByPlaceholderText(/search issues/i), { target: { value: "login" } });
    await waitFor(() => expect(screen.getByTestId("params").textContent).toContain("q="));

    expect(screen.getByRole("button", { name: "Filters · 1", hidden: true })).toBeInTheDocument();
  });
});
