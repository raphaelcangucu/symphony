import { describe, expect, it } from "vitest";
import { cloneProgressReducer, initialCloneState } from "@/hooks/useCloneProgress";

describe("cloneProgressReducer", () => {
  it("tracks started -> succeeded", () => {
    let state = initialCloneState;
    state = cloneProgressReducer(state, { event: "clone_started", repository_id: "1", github_full_name: "g/api" });
    expect(state.jobs["1"].status).toBe("running");

    state = cloneProgressReducer(state, { event: "clone_succeeded", repository_id: "1", commit_sha: "abc" });
    expect(state.jobs["1"].status).toBe("succeeded");
    expect(state.allSucceeded).toBe(true);
    expect(state.anyFailed).toBe(false);
  });

  it("flags failures", () => {
    let state = initialCloneState;
    state = cloneProgressReducer(state, { event: "clone_started", repository_id: "1", github_full_name: "g/api" });
    state = cloneProgressReducer(state, { event: "clone_failed", repository_id: "1", error: "boom" });
    expect(state.anyFailed).toBe(true);
    expect(state.jobs["1"].error).toBe("boom");
  });
});
