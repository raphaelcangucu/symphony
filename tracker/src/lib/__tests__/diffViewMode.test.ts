import { afterEach, describe, expect, it } from "vitest";

import { diffStyleForDiffViewMode, loadDiffViewMode, normalizeDiffViewMode, saveDiffViewMode } from "@/lib/diffViewMode";

afterEach(() => {
  window.localStorage.clear();
});

describe("diffViewMode", () => {
  it("defaults to split when nothing is stored", () => {
    expect(loadDiffViewMode()).toBe("split");
  });

  it("round-trips through localStorage", () => {
    saveDiffViewMode("unified");
    expect(loadDiffViewMode()).toBe("unified");
    saveDiffViewMode("split");
    expect(loadDiffViewMode()).toBe("split");
  });

  it("normalizes only supported view modes", () => {
    expect(normalizeDiffViewMode("split")).toBe("split");
    expect(normalizeDiffViewMode("unified")).toBe("unified");
    expect(normalizeDiffViewMode("bad")).toBe("split");
  });

  it("maps modes to @pierre/diffs diffStyle options", () => {
    expect(diffStyleForDiffViewMode("split")).toBe("split");
    expect(diffStyleForDiffViewMode("unified")).toBe("unified");
  });
});
