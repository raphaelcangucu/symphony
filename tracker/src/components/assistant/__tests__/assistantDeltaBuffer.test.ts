import { describe, expect, it, vi } from "vitest";

import {
  createAssistantDeltaBuffer,
  type FrameScheduler,
} from "@/components/assistant/assistantDeltaBuffer";

function manualScheduler(): FrameScheduler & { run: () => void; scheduled: number; canceled: number } {
  let callback: (() => void) | null = null;
  return {
    scheduled: 0,
    canceled: 0,
    schedule(cb) {
      this.scheduled += 1;
      callback = cb;
      return this.scheduled;
    },
    cancel() {
      this.canceled += 1;
      callback = null;
    },
    run() {
      const current = callback;
      callback = null;
      current?.();
    },
  };
}

describe("createAssistantDeltaBuffer", () => {
  it("coalesces multiple deltas into a single ordered flush per frame", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.push("Hel");
    buffer.push("lo, ");
    buffer.push("world");

    expect(onFlush).not.toHaveBeenCalled();
    expect(scheduler.scheduled).toBe(1);

    scheduler.run();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("Hello, world");
  });

  it("schedules a fresh frame for deltas that arrive after a flush", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.push("a");
    scheduler.run();
    buffer.push("b");
    scheduler.run();

    expect(onFlush.mock.calls).toEqual([["a"], ["b"]]);
    expect(scheduler.scheduled).toBe(2);
  });

  it("flush() drains synchronously and cancels the pending frame", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.push("final tokens");
    buffer.flush();

    expect(onFlush).toHaveBeenCalledExactlyOnceWith("final tokens");
    expect(scheduler.canceled).toBe(1);

    // A subsequent frame callback must not double-flush.
    scheduler.run();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op when nothing is pending", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("dispose() drops buffered deltas without flushing", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.push("orphaned");
    buffer.dispose();
    scheduler.run();

    expect(onFlush).not.toHaveBeenCalled();
    expect(scheduler.canceled).toBe(1);
  });

  it("ignores empty and non-string deltas", () => {
    const scheduler = manualScheduler();
    const onFlush = vi.fn();
    const buffer = createAssistantDeltaBuffer({ onFlush, scheduler });

    buffer.push("");
    buffer.push(undefined as unknown as string);
    expect(scheduler.scheduled).toBe(0);

    buffer.push("real");
    buffer.flush();
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("real");
  });

  it("throws without an onFlush callback", () => {
    expect(() => createAssistantDeltaBuffer({} as never)).toThrow(/onFlush/);
  });
});
