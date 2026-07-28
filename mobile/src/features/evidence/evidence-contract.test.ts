import { describe, expect, it } from "vitest";

import { normalizeEvidenceRecords } from "./evidence-contract";

describe("evidence contract", () => {
  it("normalizes durable runs and their image, video, report, and trace artifacts", () => {
    const records = normalizeEvidenceRecords({
      records: [
        {
          id: 7,
          run_id: "run-1",
          session_id: "session-1",
          status: "passed",
          ui_change: true,
          inserted_at: "2026-07-27T10:00:00Z",
          provenance: {
            execution_path: "session",
            agent_kind: "codex",
            thread_id: 42,
            requested_model: "gpt-5.6-sol",
            requested_effort: "high",
            resolved_model: "gpt-5.6-sol",
            resolved_effort: "high",
          },
          manifest: {
            issue: "DEV-2",
            generated_at: "2026-07-27T09:59:00Z",
            runs: [
              {
                kind: "e2e",
                repo: "site",
                command: "npm run test:e2e",
                status: "passed",
                duration_ms: 1234,
                report: "artifacts/report.txt",
                screenshots: [
                  {
                    path: "artifacts/home.png",
                    label: "Home",
                    navigations: ["http://127.0.0.1:23000/"],
                  },
                ],
                videos: ["artifacts/flow.mp4"],
                trace: "artifacts/trace.zip",
                proof: { title: "Dev10x home" },
              },
            ],
          },
        },
        { run_id: "", manifest: {} },
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 7,
      runId: "run-1",
      sessionId: "session-1",
      status: "passed",
      uiChange: true,
      provenance: {
        executionPath: "session",
        agentKind: "codex",
        threadId: 42,
        executionSessionId: null,
        requestedModel: "gpt-5.6-sol",
        requestedEffort: "high",
        resolvedModel: "gpt-5.6-sol",
        resolvedEffort: "high",
      },
    });
    expect(records[0].manifest.runs[0].artifacts).toEqual([
      {
        kind: "report",
        path: "artifacts/report.txt",
        label: "report",
        navigations: [],
      },
      {
        kind: "image",
        path: "artifacts/home.png",
        label: "Home",
        navigations: ["http://127.0.0.1:23000/"],
      },
      {
        kind: "video",
        path: "artifacts/flow.mp4",
        label: "flow",
        navigations: [],
      },
      {
        kind: "trace",
        path: "artifacts/trace.zip",
        label: "trace",
        navigations: [],
      },
    ]);
  });

  it("accepts a direct array returned by a task-scoped cache", () => {
    expect(
      normalizeEvidenceRecords([
        {
          run_id: "run-2",
          status: "failed",
          manifest: { issue: "DEV-2", runs: [] },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        runId: "run-2",
        status: "failed",
        manifest: expect.objectContaining({ issue: "DEV-2", runs: [] }),
      }),
    ]);
  });
});
