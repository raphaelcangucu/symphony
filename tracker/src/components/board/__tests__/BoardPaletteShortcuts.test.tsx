import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { WorkspaceFiltersRoute } from "@/components/workspace/WorkspaceFiltersRoute";
import * as viewerService from "@/services/viewer";

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "x", view: "board", knownLogins: [] }),
}));

function Harness() {
  const [params] = useSearchParams();
  return (
    <>
      <BoardPaletteShortcuts />
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

describe("BoardPaletteShortcuts", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it("opens the palette via Cmd+K", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it("opens the drawer and focuses search when '/' is pressed", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("/");

    expect(await screen.findByPlaceholderText(/search issues/i)).toHaveFocus();
  });

  it("'Filter: Assigned to me' sets assignee=me", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Assigned to me/i));

    expect(screen.getByTestId("params").textContent).toContain("assignee=me");
  });

  it("'Clear filters' resets URL params", async () => {
    renderHarness();
    await waitFor(() => expect(document.body).toBeInTheDocument());

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Assigned to me/i));
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText(/Clear filters/i));

    expect(screen.getByTestId("params").textContent).toBe("");
  });
});
