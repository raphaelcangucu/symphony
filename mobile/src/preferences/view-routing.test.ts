import { describe, expect, it } from "vitest";

import { routeForView } from "./view-routing";

describe("view routing", () => {
  it("maps the same session target into the active device view", () => {
    const target = { hostId: "host-a", kind: "session" as const, id: "42" };

    expect(routeForView("orca", target)).toBe("/h/host-a/session/42");
    expect(routeForView("codex", target)).toBe("/codex/session/42");
  });

  it("maps issue and pull-request targets without losing host identity", () => {
    const issue = {
      hostId: "host-a",
      kind: "issue" as const,
      projectSlug: "dev10x",
      identifier: "DEV-101",
    };

    expect(routeForView("orca", issue)).toBe(
      "/h/host-a/tasks?projectSlug=dev10x&identifier=DEV-101",
    );
    expect(routeForView("codex", issue)).toBe("/codex/issue/dev10x/DEV-101");
    expect(routeForView("codex", { ...issue, pullRequest: true })).toBe(
      "/codex/issue/dev10x/DEV-101/pull-request",
    );
  });
});
