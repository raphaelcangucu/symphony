import { describe, expect, it } from "vitest";

import {
  buildFloatingSurfaceId,
  type FloatingSurfaceOpenInput,
} from "@/lib/floatingSurfaceIds";

describe("buildFloatingSurfaceId", () => {
  it("builds stable ids per kind", () => {
    expect(
      buildFloatingSurfaceId({
        kind: "dev-server-output",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
        serverId: 9,
        serverSlug: "web",
      }),
    ).toBe("dev-server-output:acme:ACME-1:9");

    expect(
      buildFloatingSurfaceId({
        kind: "issue-terminal",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
      }),
    ).toBe("issue-terminal:acme:ACME-1");

    expect(
      buildFloatingSurfaceId({
        kind: "project-terminal",
        projectSlug: "acme",
        tabId: "shell",
      }),
    ).toBe("project-terminal:acme:shell");

    expect(
      buildFloatingSurfaceId({
        kind: "minibrowser",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
        serverId: 2,
        homeUrl: "http://localhost:5173/",
      }),
    ).toBe("minibrowser:acme:ACME-1:2");
  });

  it("rejects empty projectSlug", () => {
    const input: FloatingSurfaceOpenInput = {
      kind: "project-terminal",
      projectSlug: "  ",
      tabId: "shell",
    };
    expect(() => buildFloatingSurfaceId(input)).toThrow(/projectSlug/i);
  });
});
