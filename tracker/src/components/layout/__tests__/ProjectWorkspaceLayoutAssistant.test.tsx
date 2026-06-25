import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";

const fetchProjectEditorTargetsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    browser: { available: false, url: null, reason: "disabled" as const },
    cursorDesktop: { available: true, url: "cursor://file//tmp/macro-markets", reason: null },
  })),
);

vi.mock("@/components/layout/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkspace: () => ({
    projectSlug: "macro-markets",
    view: "board",
    trackerKind: "local",
    refetch: vi.fn(),
    refreshing: false,
    issues: [],
  }),
}));

vi.mock("@/components/board/BoardPaletteShortcuts", () => ({
  BoardPaletteShortcuts: () => null,
}));

vi.mock("@/services/editor", async () => {
  const actual = await vi.importActual<typeof import("@/services/editor")>("@/services/editor");
  return {
    ...actual,
    fetchProjectEditorTargets: fetchProjectEditorTargetsMock,
  };
});

describe("ProjectWorkspaceLayout assistant entry", () => {
  beforeEach(() => {
    fetchProjectEditorTargetsMock.mockClear();
  });

  it("hides board filters outside the board view", () => {
    for (const path of [
      "/projects/macro-markets/settings",
      "/projects/macro-markets/list",
      "/projects/macro-markets/assistant/explore",
    ]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
              <Route path="settings" element={<div>Settings route</div>} />
              <Route path="list" element={<div>List route</div>} />
              <Route path="assistant/explore" element={<div>Explore route</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.queryByText("Quick filters")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("exposes the project assistant entry points from workspace chrome", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
            <Route path="board" element={<div>Board route</div>} />
            <Route path="assistant/new-issue" element={<div>Assistant route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Assistant options" }));

    expect((await screen.findByRole("menuitem", { name: "Create issue" })).getAttribute("href")).toBe(
      "/projects/macro-markets/assistant/new-issue",
    );
    expect(screen.getByRole("menuitem", { name: "Explore project" }).getAttribute("href")).toBe(
      "/projects/macro-markets/assistant/explore",
    );
  });

  it("shows an editor menu on the project explore route and opens Cursor Desktop", async () => {
    const user = userEvent.setup();
    const appendChild = vi.spyOn(document.body, "appendChild");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/assistant/explore"]}>
        <Routes>
          <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
            <Route path="assistant/explore" element={<div>Explore route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchProjectEditorTargetsMock).toHaveBeenCalledWith("macro-markets"));

    await user.click(await screen.findByRole("button", { name: "Open project workspace in Code" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cursor" }));

    const openedAnchor = appendChild.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);

    expect(openedAnchor?.href).toBe("cursor://file//tmp/macro-markets");
  });
});
