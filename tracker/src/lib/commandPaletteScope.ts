// Coordinates global ⌘K ownership between command palettes. Both the board-level
// palette and the issue execution palette register window keydown listeners, so
// without coordination ⌘K would toggle both at once. Overlay palettes (mounted on
// top of the board, e.g. the execution palette) register themselves here; the
// board palette yields ⌘K while any overlay palette is active.

let activeOverlayPalettes = 0;

export function acquireOverlayPalette(): () => void {
  activeOverlayPalettes += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeOverlayPalettes = Math.max(0, activeOverlayPalettes - 1);
  };
}

export function isOverlayPaletteActive(): boolean {
  return activeOverlayPalettes > 0;
}
