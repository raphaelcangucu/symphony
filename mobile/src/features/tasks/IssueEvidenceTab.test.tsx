import { fireEvent, render, screen } from "@testing-library/react-native";

import type { EvidenceRecord } from "@/features/evidence/evidence-contract";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssueEvidenceTab } from "./IssueEvidenceTab";

const record: EvidenceRecord = {
  id: 6,
  runId: "run-vin-3-006",
  sessionId: "6",
  status: "passed",
  uiChange: true,
  insertedAt: "2026-07-29T16:30:00Z",
  provenance: {
    executionPath: "orchestrator",
    agentKind: "codex",
    threadId: 6,
    executionSessionId: 6,
    requestedModel: "gpt-5.6-sol",
    requestedEffort: "high",
    resolvedModel: "gpt-5.6-sol",
    resolvedEffort: "high",
  },
  manifest: {
    issue: "VIN-3",
    generatedAt: "2026-07-29T16:30:00Z",
    uiChange: true,
    runs: [
      {
        kind: "e2e",
        repo: "mobile",
        command: "npm run test:e2e:android",
        status: "passed",
        taskId: "VIN-3",
        taskTitle: "Mobile navigation",
        durationMs: 1200,
        blockedReason: null,
        summary: null,
        proof: {},
        artifacts: [
          { kind: "image", path: "mobile.png", label: "Mobile", navigations: [] },
          { kind: "video", path: "flow.mp4", label: "Flow video", navigations: [] },
        ],
      },
    ],
  },
};

describe("IssueEvidenceTab", () => {
  it("summarizes provenance and artifacts from the latest run", () => {
    const onOpen = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <IssueEvidenceTab error={null} loading={false} onOpen={onOpen} records={[record]} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("gpt-5.6-sol · high")).toBeTruthy();
    expect(screen.getByText("Mobile")).toBeTruthy();
    expect(screen.getByText("Flow video")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "View complete evidence run" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
