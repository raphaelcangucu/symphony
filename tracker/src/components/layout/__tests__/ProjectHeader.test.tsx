import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProjectHeader } from "@/components/layout/ProjectHeader";

function renderHeader(pollingActive: boolean) {
  return render(
    <MemoryRouter>
      <ProjectHeader projectSlug="macro-markets" view="board" trackerKind="github" pollingActive={pollingActive} />
    </MemoryRouter>,
  );
}

describe("ProjectHeader polling indicator", () => {
  it("labels the indicator active when polling is active", () => {
    renderHeader(true);
    expect(screen.getByLabelText("Polling active")).toBeInTheDocument();
    expect(screen.queryByLabelText("Polling paused (window not focused)")).toBeNull();
  });

  it("labels the indicator paused when polling is inactive", () => {
    renderHeader(false);
    expect(screen.getByLabelText("Polling paused (window not focused)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Polling active")).toBeNull();
  });

  it("does not render the indicator for local trackers", () => {
    render(
      <MemoryRouter>
        <ProjectHeader projectSlug="macro-markets" view="board" trackerKind="local" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Polling active")).toBeNull();
    expect(screen.queryByLabelText("Polling paused (window not focused)")).toBeNull();
  });
});
