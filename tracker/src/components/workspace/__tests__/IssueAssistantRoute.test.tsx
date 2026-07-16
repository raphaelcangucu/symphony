import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { IssueAssistantRoute } from "@/components/workspace/IssueAssistantRoute";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectSlug/assistant/new-issue" element={<IssueAssistantRoute />} />
        <Route path="/projects/:projectSlug/assistant/issue/:issueId" element={<IssueAssistantRoute />} />
        <Route path="/projects/:projectSlug/workspaces" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IssueAssistantRoute", () => {
  it("redirects new-issue to the workspaces ephemeral tab deep link", () => {
    renderAt("/projects/macro/assistant/new-issue");

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/macro/workspaces?new=1");
  });

  it("redirects issue authoring to the workspaces authoring session deep link", () => {
    renderAt("/projects/macro/assistant/issue/MAC-8");

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/macro/workspaces?exec=MAC-8");
  });
});
