import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_FLOATING_SURFACES,
  bringFloatingSurfaceToFront,
  closeFloatingSurface,
  listFloatingSurfaces,
  openFloatingSurface,
  resetFloatingSurfaceStoreForTests,
  updateFloatingSurfaceBounds,
} from "@/stores/floatingSurfaceStore";

afterEach(() => {
  resetFloatingSurfaceStoreForTests();
});

describe("floatingSurfaceStore", () => {
  it("opens, dedupes by id, and raises z-index on focus", () => {
    const first = openFloatingSurface({
      kind: "issue-terminal",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      title: "Terminal",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = openFloatingSurface({
      kind: "issue-terminal",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      title: "Terminal",
    });
    expect(again).toEqual({ ok: true, id: first.id, focusedExisting: true });
    expect(listFloatingSurfaces()).toHaveLength(1);

    const other = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "shell",
      title: "Project",
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;

    bringFloatingSurfaceToFront(first.id);
    const ordered = [...listFloatingSurfaces()].sort((a, b) => a.zIndex - b.zIndex);
    expect(ordered.at(-1)?.id).toBe(first.id);
  });

  it("rejects a 7th distinct surface", () => {
    for (let i = 1; i <= MAX_FLOATING_SURFACES; i += 1) {
      const result = openFloatingSurface({
        kind: "project-terminal",
        projectSlug: "acme",
        tabId: `tab-${i}`,
        title: `T${i}`,
      });
      expect(result.ok).toBe(true);
    }
    const overflow = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "tab-overflow",
      title: "Nope",
    });
    expect(overflow).toEqual({ ok: false, reason: "max_surfaces" });
  });

  it("refocuses an existing surface when at max capacity", () => {
    const first = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "tab-1",
      title: "T1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    for (let i = 2; i <= MAX_FLOATING_SURFACES; i += 1) {
      const result = openFloatingSurface({
        kind: "project-terminal",
        projectSlug: "acme",
        tabId: `tab-${i}`,
        title: `T${i}`,
      });
      expect(result.ok).toBe(true);
    }

    const refocused = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "tab-1",
      title: "T1",
    });
    expect(refocused).toEqual({ ok: true, id: first.id, focusedExisting: true });
    expect(listFloatingSurfaces()).toHaveLength(MAX_FLOATING_SURFACES);
  });

  it("updates bounds and closes", () => {
    const opened = openFloatingSurface({
      kind: "minibrowser",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      serverId: 3,
      homeUrl: "http://localhost:5173/",
      title: "Preview",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    updateFloatingSurfaceBounds(opened.id, { x: 40, y: 50, width: 800, height: 500 });
    expect(listFloatingSurfaces()[0]?.bounds).toEqual({ x: 40, y: 50, width: 800, height: 500 });

    closeFloatingSurface(opened.id);
    expect(listFloatingSurfaces()).toHaveLength(0);
  });
});
