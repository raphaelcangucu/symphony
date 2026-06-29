import { describe, expect, it } from "vitest";

import { acquireOverlayPalette, isOverlayPaletteActive } from "@/lib/commandPaletteScope";

describe("commandPaletteScope", () => {
  it("is inactive by default", () => {
    expect(isOverlayPaletteActive()).toBe(false);
  });

  it("activates while at least one overlay palette is held", () => {
    const release = acquireOverlayPalette();
    expect(isOverlayPaletteActive()).toBe(true);

    release();
    expect(isOverlayPaletteActive()).toBe(false);
  });

  it("stays active until every holder releases", () => {
    const releaseA = acquireOverlayPalette();
    const releaseB = acquireOverlayPalette();
    expect(isOverlayPaletteActive()).toBe(true);

    releaseA();
    expect(isOverlayPaletteActive()).toBe(true);

    releaseB();
    expect(isOverlayPaletteActive()).toBe(false);
  });

  it("ignores duplicate releases from the same holder", () => {
    const release = acquireOverlayPalette();
    const other = acquireOverlayPalette();

    release();
    release();

    expect(isOverlayPaletteActive()).toBe(true);

    other();
    expect(isOverlayPaletteActive()).toBe(false);
  });
});
