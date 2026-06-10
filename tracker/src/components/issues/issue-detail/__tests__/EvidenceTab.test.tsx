import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceTab } from "../EvidenceTab";
import type { EvidenceRecord } from "@/types/evidence";

const baseProps = {
  projectSlug: "gam",
  identifier: "GAM-9",
  loading: false,
  error: null,
  onRefresh: vi.fn(),
};

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 1,
    runId: "20260610-1",
    sessionId: null,
    status: "passed",
    uiChange: true,
    insertedAt: "2026-06-10T12:00:00Z",
    runs: [
      {
        kind: "unit",
        repo: "frontend",
        command: "npm test",
        status: "passed",
        summary: { total: 3, passed: 3, failed: 0 },
        report: "artifacts/unit.txt",
        screenshots: [],
        videos: [],
        trace: null,
      },
      {
        kind: "e2e",
        repo: "frontend",
        command: "npx playwright test",
        status: "passed",
        summary: { total: 1, passed: 1, failed: 0 },
        report: null,
        screenshots: ["artifacts/screens/home.png"],
        videos: ["artifacts/videos/flow.webm"],
        trace: "artifacts/trace.zip",
      },
    ],
    ...overrides,
  };
}

describe("EvidenceTab", () => {
  it("shows the empty state when there are no records", () => {
    render(<EvidenceTab {...baseProps} records={[]} />);
    expect(screen.getByText("No evidence captured for this issue yet.")).toBeInTheDocument();
  });

  it("shows the error message", () => {
    render(<EvidenceTab {...baseProps} error="Could not load evidence." records={[]} />);
    expect(screen.getByText("Could not load evidence.")).toBeInTheDocument();
  });

  it("renders run rows, screenshots and videos for a record", () => {
    const { container } = render(<EvidenceTab {...baseProps} records={[record()]} />);

    expect(screen.getByText("unit")).toBeInTheDocument();
    expect(screen.getByText("e2e")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("3/3 passed, 0 failed")).toBeInTheDocument();
    expect(screen.getByText("UI change")).toBeInTheDocument();

    const image = screen.getByRole("img", { name: "home.png" });
    expect(image.getAttribute("src")).toContain(
      "/projects/gam/issues/GAM-9/evidence/20260610-1/artifacts/artifacts/screens/home.png",
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toContain("artifacts/videos/flow.webm");

    const traceLink = screen.getByRole("link", { name: "e2e trace (frontend)" });
    expect(traceLink.getAttribute("href")).toContain("artifacts/trace.zip");
  });
});
