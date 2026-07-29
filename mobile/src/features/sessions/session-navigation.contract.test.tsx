import { assistantThreadDiffRoute } from "./session-navigation";

describe("assistantThreadDiffRoute", () => {
  it("uses the provider-neutral session route", () => {
    expect(assistantThreadDiffRoute(42)).toBe("/session/42/diff");
  });

  it("does not manufacture a route for a non-thread workspace id", () => {
    expect(assistantThreadDiffRoute("worktree-uuid")).toBeNull();
  });
});
