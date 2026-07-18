import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FloatingSurfaceHost } from "@/components/floating/FloatingSurfaceHost";
import { initTestI18n } from "@/i18n/testUtils";
import {
  openFloatingSurface,
  resetFloatingSurfaceStoreForTests,
} from "@/stores/floatingSurfaceStore";

vi.mock("@/components/terminal/ProjectTerminalWorkspace", () => ({
  ProjectTerminalWorkspace: () => <div>Project terminal</div>,
}));

vi.mock("@/components/terminal/TerminalWorkspacePanel", () => ({
  TerminalWorkspacePanel: () => <div>Issue terminal</div>,
}));

vi.mock("@/components/terminal/TerminalView", () => ({
  TerminalView: () => <div>Dev server output</div>,
}));

afterEach(() => {
  resetFloatingSurfaceStoreForTests();
});

describe("FloatingSurfaceHost", () => {
  it("keeps an open surface mounted across route changes", async () => {
    await initTestI18n();
    openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "shell",
      title: "Project shell",
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/a"]}>
        <FloatingSurfaceHost />
        <Routes>
          <Route path="/a" element={<div>Page A</div>} />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/b"]}>
        <FloatingSurfaceHost />
        <Routes>
          <Route path="/a" element={<div>Page A</div>} />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();
  });
});
