import { describe, expect, it } from "vitest";

import { canRetryComparisonCell, normalizeComparisonSnapshot } from "./comparison-contract";

const cells = [
  {
    id: "orchestrator-claude",
    path: "orchestrator",
    provider: "claude",
    requested_model: "claude-opus-5",
    requested_effort: "high",
    effective_effort: "high",
    status: "blocked",
    issue_identifier: "DEV-7",
  },
  {
    id: "session-cursor",
    path: "session",
    provider: "cursor",
    requested_model: "cursor-grok-4.5-high",
    requested_effort: null,
    effective_effort: null,
    status: "live",
    issue_identifier: "DEV-3",
  },
  {
    id: "session-codex",
    path: "session",
    provider: "codex",
    requested_model: "gpt-5.6-sol",
    requested_effort: "high",
    effective_effort: "high",
    status: "passed",
    issue_identifier: "DEV-2",
  },
  {
    id: "orchestrator-cursor",
    path: "orchestrator",
    provider: "cursor",
    requested_model: "cursor-grok-4.5-high",
    requested_effort: null,
    effective_effort: "high",
    status: "failed",
    issue_identifier: "DEV-6",
  },
  {
    id: "session-claude",
    path: "session",
    provider: "claude",
    requested_model: "claude-opus-5",
    requested_effort: "high",
    effective_effort: "high",
    status: "saved",
    issue_identifier: "DEV-4",
  },
  {
    id: "orchestrator-codex",
    path: "orchestrator",
    provider: "codex",
    requested_model: "gpt-5.6-sol",
    requested_effort: "high",
    effective_effort: "high",
    status: "starting",
    issue_identifier: "DEV-5",
  },
];

describe("comparison contract", () => {
  it("keeps only canonical cells, orders them, and recomputes progress", () => {
    const snapshot = normalizeComparisonSnapshot({
      project_slug: "dev10x",
      identifier: "DEV-1",
      title: "Compare the Dev10x landing",
      status: "completed",
      progress: { terminal: 99, passed: 99, failed: 0, total: 99 },
      cells: [
        ...cells,
        { id: "session-nope", path: "session", provider: "nope" },
        { id: "session-codex", status: 42 },
      ],
      decision: null,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.cells.map((cell) => cell.id)).toEqual([
      "session-codex",
      "session-cursor",
      "session-claude",
      "orchestrator-codex",
      "orchestrator-cursor",
      "orchestrator-claude",
    ]);
    expect(snapshot?.progress).toEqual({ terminal: 4, passed: 2, failed: 2, total: 6 });
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.cells[1]).toMatchObject({
      provider: "cursor",
      requestedEffort: null,
      effectiveEffort: "high",
    });
  });

  it("allows retry only for terminal failure states", () => {
    const snapshot = normalizeComparisonSnapshot({
      project_slug: "dev10x",
      identifier: "DEV-1",
      cells,
    });

    expect(canRetryComparisonCell(snapshot!.cells[0])).toBe(false);
    expect(canRetryComparisonCell(snapshot!.cells[4])).toBe(true);
    expect(canRetryComparisonCell(snapshot!.cells[5])).toBe(true);
  });

  it("rejects malformed snapshots and malformed canonical rows", () => {
    expect(normalizeComparisonSnapshot(null)).toBeNull();
    expect(normalizeComparisonSnapshot({ project_slug: "", identifier: "DEV-1" })).toBeNull();

    const snapshot = normalizeComparisonSnapshot({
      project_slug: "dev10x",
      identifier: "DEV-1",
      cells: [{ id: "session-codex", status: 42 }],
    });
    expect(snapshot?.cells).toEqual([]);
  });
});
