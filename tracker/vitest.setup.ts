import "@testing-library/jest-dom/vitest";

// jsdom does not implement PointerEvent. Radix UI primitives open on
// pointerdown and require `event.button === 0`; without a PointerEvent class,
// fireEvent.pointerDown dispatches an event with no `button`, so menus never
// open. Alias it to MouseEvent (which defaults `button` to 0).
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  window.PointerEvent = window.MouseEvent as typeof window.PointerEvent;
  globalThis.PointerEvent = window.MouseEvent as typeof globalThis.PointerEvent;
}

// jsdom does not implement Pointer Capture or scrollIntoView, both of which
// Radix UI primitives (dropdown menu, dialog, etc.) rely on to open. Without
// these, menus never reach the "open" state and queries for their items fail.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}
