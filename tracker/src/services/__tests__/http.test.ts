import { describe, expect, it } from "vitest";

import { trackerPath, unwrapData } from "../http";

describe("http helpers", () => {
  it("prefixes tracker API paths", () => {
    expect(trackerPath("/projects")).toBe("/api/tracker/v1/projects");
  });

  it("rejects relative paths without a leading slash", () => {
    expect(() => trackerPath("projects")).toThrow(/must start/);
  });

  it("unwraps Phoenix-style envelopes and raw payloads", () => {
    expect(unwrapData({ data: { data: [1, 2] } })).toEqual([1, 2]);
    expect(unwrapData({ data: [1, 2] })).toEqual([1, 2]);
  });
});
