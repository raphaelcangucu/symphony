import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSessionPage } from "@/pages/ProjectSessionPage";

const projectSessionsWorkspace = vi.fn(({ activeThreadId }: { activeThreadId?: number | null }) => (
  <section aria-label="mock sessions workspace">
    <div>thread:{activeThreadId ?? "none"}</div>
  </section>
));

vi.mock("@/components/sessions/ProjectSessionsWorkspace", () => ({
  ProjectSessionsWorkspace: (props: { activeThreadId?: number | null }) => projectSessionsWorkspace(props),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectSlug/sessions/:threadId" element={<ProjectSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectSessionPage", () => {
  beforeEach(() => {
    projectSessionsWorkspace.mockClear();
  });

  it("renders the tabbed sessions workspace for a thread route", async () => {
    renderAt("/projects/macro-markets/sessions/42");

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "mock sessions workspace" })).toBeInTheDocument(),
    );
    expect(screen.getByText("thread:42")).toBeInTheDocument();
    expect(projectSessionsWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ activeThreadId: 42 }),
    );
  });
});
