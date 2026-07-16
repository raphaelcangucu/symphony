import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachChatScrollStickiness,
  captureScrollBeforePrepend,
  restoreScrollAfterPrepend,
  STICK_TO_BOTTOM_THRESHOLD_PX,
} from "@/components/assistant/chatScrollStickiness";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  disconnect() {
    this.observed = [];
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("attachChatScrollStickiness", () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
  });

  it("keeps stick-to-bottom and scrolls when content grows while stuck", () => {
    const stickToBottomRef = { current: true };
    const pinnedScrollTopRef = { current: null as number | null };
    const onAtBottomChange = vi.fn();

    const content = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.appendChild(content);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => 800 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      if (typeof options.top === "number") scroller.scrollTop = options.top;
    });
    scroller.scrollTo = scrollTo as typeof scroller.scrollTo;

    attachChatScrollStickiness(scroller, stickToBottomRef, pinnedScrollTopRef, onAtBottomChange);

    // Content grew: distance from bottom is now large, but we were stuck.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 1200 });
    FakeResizeObserver.instances[0]?.trigger();

    expect(stickToBottomRef.current).toBe(true);
    expect(pinnedScrollTopRef.current).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "auto" });
    expect(onAtBottomChange).toHaveBeenCalledWith(true);
  });

  it("detaches stickiness when the user scrolls away from the bottom", () => {
    const stickToBottomRef = { current: true };
    const pinnedScrollTopRef = { current: null as number | null };

    const content = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.appendChild(content);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => 800 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    scroller.scrollTo = vi.fn() as typeof scroller.scrollTo;

    attachChatScrollStickiness(scroller, stickToBottomRef, pinnedScrollTopRef);

    scroller.dispatchEvent(new Event("scroll"));

    expect(stickToBottomRef.current).toBe(false);
    expect(pinnedScrollTopRef.current).toBe(0);
    expect(800 - 0 - 200).toBeGreaterThan(STICK_TO_BOTTOM_THRESHOLD_PX);
  });
});

describe("prepend scroll restore", () => {
  function mockScroller(initial: { scrollHeight: number; scrollTop: number }) {
    let scrollHeight = initial.scrollHeight;
    let scrollTop = initial.scrollTop;
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: {
        configurable: true,
        get: () => scrollHeight,
        set: (value: number) => {
          scrollHeight = value;
        },
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    return {
      scroller,
      setScrollHeight: (value: number) => {
        scrollHeight = value;
      },
    };
  }

  it("keeps the same viewport after content is prepended above", () => {
    const stickToBottomRef = { current: false };
    const pinnedScrollTopRef = { current: 0 as number | null };
    const { scroller, setScrollHeight } = mockScroller({ scrollHeight: 800, scrollTop: 0 });

    const pending = captureScrollBeforePrepend(scroller, stickToBottomRef, pinnedScrollTopRef);
    setScrollHeight(1800);
    restoreScrollAfterPrepend(scroller, pending, pinnedScrollTopRef);

    expect(scroller.scrollTop).toBe(1000);
    expect(pinnedScrollTopRef.current).toBe(1000);
    expect(stickToBottomRef.current).toBe(false);
  });

  it("detaches stick-to-bottom so growth does not jump to the new bottom", () => {
    const stickToBottomRef = { current: true };
    const pinnedScrollTopRef = { current: null as number | null };
    const { scroller, setScrollHeight } = mockScroller({ scrollHeight: 800, scrollTop: 600 });

    const pending = captureScrollBeforePrepend(scroller, stickToBottomRef, pinnedScrollTopRef);
    expect(stickToBottomRef.current).toBe(false);

    setScrollHeight(1400);
    restoreScrollAfterPrepend(scroller, pending, pinnedScrollTopRef);

    expect(scroller.scrollTop).toBe(1200);
    expect(pinnedScrollTopRef.current).toBe(1200);
  });
});
