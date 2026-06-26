import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { initTestI18n } from "@/i18n/testUtils";

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
  Element.prototype.scrollTo ??= () => undefined;
}

// jsdom does not implement ResizeObserver, which the assistant page uses to
// size the chat scroll area around its floating composer.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement IntersectionObserver, which the KB editor's table of
// contents uses to highlight the active section while the panel is open.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom does not implement layout, so Range geometry returns nothing. ProseMirror
// (Tiptap) measures selection rects on every transaction; without these it throws
// while rendering the editor in tests.
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect ??= () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
}

await initTestI18n("en");

afterEach(async () => {
  await initTestI18n("en");
});
