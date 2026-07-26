import { describe, expect, it } from "vitest";

import { routeForView } from "./view-routing";

describe("view routing", () => {
  it("maps every session target into the unified host chat", () => {
    const target = { hostId: "host-a", kind: "session" as const, id: "42" };

    expect(routeForView(target)).toBe("/h/host-a/chat/42");
  });

  it("maps issue and pull-request targets without losing host identity", () => {
    const issue = {
      hostId: "host-a",
      kind: "issue" as const,
      projectSlug: "dev10x",
      identifier: "DEV-101",
    };

    expect(routeForView(issue)).toBe(
      "/h/host-a/tasks?projectSlug=dev10x&identifier=DEV-101",
    );
    expect(routeForView({ ...issue, pullRequest: true })).toBe(
      "/h/host-a/tasks?projectSlug=dev10x&identifier=DEV-101",
    );
  });
});
