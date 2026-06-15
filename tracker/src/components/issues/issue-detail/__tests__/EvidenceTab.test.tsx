import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EvidenceTab } from "../EvidenceTab";
import type { EvidenceRecord } from "@/types/evidence";
import type { Issue } from "@/types/issue";

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

const baseProps = {
  projectSlug: "advising",
  identifier: "CDE-1131",
  loading: false,
  error: null,
  onRefresh: vi.fn(),
};

const issue = {
  id: "1",
  identifier: "CDE-1131",
  title: "Evidence gap",
  status: "Revisão de pares",
  priority: 0,
  assignee: null,
  projectSlug: "advising",
  blockedBy: [],
  labels: [],
} as unknown as Issue;

const trackerConfig = {
  activeStates: ["Em andamento"],
  dispatchStates: ["Selected for Development"],
  waitStates: ["Revisão de pares"],
  terminalStates: ["Concluído"],
  reworkTarget: "Em andamento",
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
        repo: "advising",
        command: "./vibe test",
        status: "passed",
        summary: { total: 3, passed: 3, failed: 0 },
        report: "artifacts/unit.txt",
        screenshots: [],
        videos: [],
        trace: null,
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

  it("shows continue work when evidence is missing in review", () => {
    render(
      <EvidenceTab
        {...baseProps}
        issue={issue}
        records={[]}
        showContinueWork
        trackerConfig={trackerConfig}
      />,
    );

    expect(screen.getByText(/Evidence: ausente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /voltar para em andamento e retomar/i })).toBeInTheDocument();
  });

  it("shows continue work when the latest evidence failed", async () => {
    dispatchIssueAgentMock.mockResolvedValue({
      action: "continue_work",
      message: "Continuing",
      issue: { ...issue, status: "Em andamento" },
    });

    const user = userEvent.setup();
    render(
      <EvidenceTab
        {...baseProps}
        issue={issue}
        records={[
          record({
            status: "failed",
            runs: [
              {
                kind: "unit",
                repo: "advising",
                command: "./vibe test",
                status: "blocked",
                summary: { reason: "Docker is not running." },
                report: "artifacts/phpunit.txt",
              },
            ],
          }),
        ]}
        showContinueWork
        trackerConfig={trackerConfig}
      />,
    );

    expect(screen.getByText(/Retomar validação/)).toBeInTheDocument();
    expect(screen.getAllByText(/Docker is not running/).length).toBeGreaterThan(0);
    expect(screen.getByText("blocked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /voltar para em andamento e retomar/i }));
    expect(dispatchIssueAgentMock).toHaveBeenCalled();
  });

  it("shows the error message", () => {
    render(<EvidenceTab {...baseProps} error="Could not load evidence." records={[]} />);
    expect(screen.getByText("Could not load evidence.")).toBeInTheDocument();
  });

  it("renders run rows, screenshots and videos for a record", () => {
    const { container } = render(
      <EvidenceTab
        {...baseProps}
        records={[
          record({
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
          }),
        ]}
      />,
    );

    expect(screen.getByText("unit")).toBeInTheDocument();
    expect(screen.getByText("e2e")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("3/3 passed, 0 failed")).toBeInTheDocument();
    expect(screen.getByText("UI change")).toBeInTheDocument();

    const image = screen.getByRole("img", { name: "home.png" });
    expect(image.getAttribute("src")).toContain(
      "/projects/advising/issues/CDE-1131/evidence/20260610-1/artifacts/artifacts/screens/home.png",
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toContain("artifacts/videos/flow.webm");

    const traceLink = screen.getByRole("link", { name: "e2e trace (frontend)" });
    expect(traceLink.getAttribute("href")).toContain("artifacts/trace.zip");
  });
});
