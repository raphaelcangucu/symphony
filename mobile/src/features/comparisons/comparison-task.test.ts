import { describe, expect, it } from "vitest";

import {
  comparisonDescription,
  humanComparisonDescription,
  isComparisonTask,
} from "./comparison-task";

describe("comparison task metadata", () => {
  it("keeps the human prompt readable around a stable hidden marker", () => {
    const description = comparisonDescription("Build and compare the Dev10x landing.");

    expect(description).toContain("```dev10x-comparison");
    expect(isComparisonTask(description)).toBe(true);
    expect(humanComparisonDescription(description)).toBe("Build and compare the Dev10x landing.");
  });

  it("leaves standard task descriptions unchanged", () => {
    expect(isComparisonTask("A normal task")).toBe(false);
    expect(humanComparisonDescription("A normal task")).toBe("A normal task");
  });
});
