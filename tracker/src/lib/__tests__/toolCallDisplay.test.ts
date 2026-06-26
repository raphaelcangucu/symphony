import { describe, expect, it } from "vitest";

import { formatToolOutput, resolveToolDisplayName } from "@/lib/toolCallDisplay";

describe("toolCallDisplay", () => {
  it("infers Glob from a blocked glob error payload when the name is unknown", () => {
    const payload =
      '{"error":{"error":"Glob pattern \\"**/*\\" matches every file and is not allowed. Use a more specific glob or no glob."}}';

    expect(resolveToolDisplayName("unknown", payload)).toBe("Glob");
    expect(formatToolOutput(payload)).toBe(
      'Glob pattern "**/*" matches every file and is not allowed. Use a more specific glob or no glob.',
    );
  });

  it("keeps known cursor tool labels", () => {
    expect(resolveToolDisplayName("glob")).toBe("Glob");
    expect(resolveToolDisplayName("grep")).toBe("Grep");
  });
});
