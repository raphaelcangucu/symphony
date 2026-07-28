import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import type { EvidenceRecord } from "./evidence-contract";
import { EvidenceGallery } from "./EvidenceGallery";

describe("EvidenceGallery", () => {
  it("groups durable proof by cell and run and opens every artifact kind", () => {
    const onOpenArtifact = jest.fn();
    const record = evidenceRecord();

    render(
      <ThemeProvider colorScheme="dark">
        <EvidenceGallery
          groups={[{ label: "Session · Codex", record }]}
          onOpenArtifact={onOpenArtifact}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Session · Codex")).toBeTruthy();
    expect(screen.getByText("run-verified · passed")).toBeTruthy();
    expect(screen.getByText("E2E · 4.2s")).toBeTruthy();
    expect(screen.getByText("npm run test:e2e")).toBeTruthy();
    expect(screen.getByText(/2 passed/)).toBeTruthy();

    for (const label of ["Home", "Flow", "Report", "Trace"]) {
      fireEvent.press(screen.getByRole("button", { name: `Open ${label}` }));
    }

    expect(onOpenArtifact).toHaveBeenCalledTimes(4);
    expect(onOpenArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "image", path: "artifacts/home.png" }),
      record,
    );
    expect(onOpenArtifact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "video", path: "artifacts/flow.mp4" }),
      record,
    );
    expect(onOpenArtifact).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ kind: "report", path: "artifacts/report.md" }),
      record,
    );
    expect(onOpenArtifact).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ kind: "trace", path: "artifacts/trace.zip" }),
      record,
    );
  });
});

export function evidenceRecord(): EvidenceRecord {
  return {
    id: 1,
    runId: "run-verified",
    sessionId: "session-1",
    status: "passed",
    uiChange: true,
    insertedAt: "2026-07-27T10:00:00Z",
    provenance: null,
    manifest: {
      issue: "DEV-2",
      generatedAt: "2026-07-27T10:00:00Z",
      uiChange: true,
      runs: [
        {
          kind: "e2e",
          repo: "site",
          command: "npm run test:e2e",
          status: "passed",
          taskId: "e2e",
          taskTitle: "E2E",
          durationMs: 4200,
          blockedReason: null,
          summary: { passed: 2, failed: 0 },
          proof: { assertions: "2 passed", browser: "chromium" },
          artifacts: [
            {
              kind: "image",
              path: "artifacts/home.png",
              label: "Home",
              navigations: ["/"],
            },
            {
              kind: "video",
              path: "artifacts/flow.mp4",
              label: "Flow",
              navigations: ["/", "/evidence"],
            },
            {
              kind: "report",
              path: "artifacts/report.md",
              label: "Report",
              navigations: [],
            },
            {
              kind: "trace",
              path: "artifacts/trace.zip",
              label: "Trace",
              navigations: [],
            },
          ],
        },
      ],
    },
  };
}
