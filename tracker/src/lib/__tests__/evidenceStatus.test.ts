import { beforeEach, describe, expect, it } from "vitest";

import { initTestI18n } from "@/i18n/testUtils";
import {
  assessEvidenceAttention,
  evidenceAttentionInstructions,
  evidenceAttentionSummary,
  evidenceNeedsAttention,
} from "@/lib/evidenceStatus";
import type { EvidenceRecord } from "@/types/evidence";

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 1,
    runId: "run-1",
    sessionId: null,
    status: "passed",
    uiChange: false,
    insertedAt: "2026-06-15T00:00:00Z",
    runs: [],
    ...overrides,
  };
}

describe("evidenceStatus", () => {
  beforeEach(async () => {
    await initTestI18n("pt-BR");
  });

  it("marks missing evidence", () => {
    const attention = assessEvidenceAttention([]);
    expect(attention.kind).toBe("missing");
    expect(evidenceNeedsAttention([])).toBe(true);
    expect(evidenceAttentionSummary(attention)).toMatch(/Nenhuma evidência/);
  });

  it("marks failed record status", () => {
    const attention = assessEvidenceAttention([
      record({
        status: "failed",
        runs: [
          {
            kind: "unit",
            repo: "advising",
            command: "./vibe test",
            status: "blocked",
            summary: { reason: "Docker is not running." },
          },
        ],
      }),
    ]);

    expect(attention.kind).toBe("failed");
    expect(evidenceNeedsAttention([record({ status: "failed", runs: [] })])).toBe(true);
    expect(evidenceAttentionSummary(attention)).toMatch(/Docker is not running/);
    expect(evidenceAttentionInstructions(attention)).toMatch(/Docker is not running/);
  });

  it("treats passing record as no attention needed", () => {
    const attention = assessEvidenceAttention([
      record({
        runs: [
          {
            kind: "unit",
            repo: "advising",
            command: "./vibe test",
            status: "passed",
            summary: { total: 1, passed: 1, failed: 0 },
          },
        ],
      }),
    ]);

    expect(attention.kind).toBe("none");
    expect(evidenceNeedsAttention([record()])).toBe(false);
  });
});
