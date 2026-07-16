import { describe, expect, it } from "vitest";

import { formatWorkedDuration, summarizeToolPresentations } from "@/lib/toolCallTurnSummary";

describe("toolCallTurnSummary", () => {
  it("formats duration thresholds", () => {
    expect(formatWorkedDuration(500)).toBe("<1s");
    expect(formatWorkedDuration(45_000)).toBe("45s");
    expect(formatWorkedDuration(128_000)).toBe("2m 8s");
    expect(formatWorkedDuration(120_000)).toBe("2m");
  });

  it("aggregates family counts and formats duration", () => {
    const summary = summarizeToolPresentations(
      [{ family: "command" }, { family: "command" }, { family: "kb" }, { family: "preview" }],
      { durationMs: 128_000 },
    );
    expect(summary.headline).toMatch(/Worked for/);
    expect(summary.headline).toMatch(/2m/);
    expect(summary.chips.some((chip) => chip.count === 2 && chip.family === "command")).toBe(true);
  });

  it("uses chips-only headline when duration is unknown", () => {
    const summary = summarizeToolPresentations([{ family: "command" }], { durationMs: 0 });
    expect(summary.headline).toBe("Worked this turn");
  });
});
