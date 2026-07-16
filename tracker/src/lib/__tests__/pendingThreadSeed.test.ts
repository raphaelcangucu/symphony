import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingThreadSeed,
  consumePendingThreadSeed,
  stashPendingThreadSeed,
} from "@/lib/pendingThreadSeed";

describe("pendingThreadSeed", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearPendingThreadSeed(42);
    clearPendingThreadSeed(99);
  });

  afterEach(() => {
    sessionStorage.clear();
    clearPendingThreadSeed(42);
    clearPendingThreadSeed(99);
  });

  it("stashes and consumes a seed for the matching thread", () => {
    stashPendingThreadSeed(42, "  kick off triage  ");

    expect(consumePendingThreadSeed(42)).toBe("kick off triage");
  });

  it("returns the seed again after consume so StrictMode remounts still see it", () => {
    stashPendingThreadSeed(42, "start the plan");

    expect(consumePendingThreadSeed(42)).toBe("start the plan");
    expect(consumePendingThreadSeed(42)).toBe("start the plan");
    expect(sessionStorage.getItem("symphony:pending-thread-seed")).toBeNull();
  });

  it("stops returning the seed after clearPendingThreadSeed", () => {
    stashPendingThreadSeed(42, "start the plan");
    expect(consumePendingThreadSeed(42)).toBe("start the plan");

    clearPendingThreadSeed(42);

    expect(consumePendingThreadSeed(42)).toBeNull();
  });

  it("ignores a seed stashed for a different thread", () => {
    stashPendingThreadSeed(42, "for forty-two");

    expect(consumePendingThreadSeed(99)).toBeNull();
    expect(consumePendingThreadSeed(42)).toBe("for forty-two");
  });
});
