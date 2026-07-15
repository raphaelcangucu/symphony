/**
 * Coalesces high-frequency `assistant_delta` events into at most one flush per
 * animation frame. Streaming a large turn can emit hundreds of deltas per
 * second; applying each one as its own React `setState` floods the main thread
 * and freezes navigation/composer. Batching keeps rendering bounded to the frame
 * rate while preserving delta order and never dropping the final tokens.
 */

export interface FrameScheduler {
  schedule: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

export interface AssistantDeltaBufferOptions {
  /** Receives the ordered concatenation of every delta buffered since the last flush. */
  onFlush: (coalesced: string) => void;
  /** Frame scheduler. Defaults to requestAnimationFrame with a timeout fallback. */
  scheduler?: FrameScheduler;
}

export interface AssistantDeltaBuffer {
  /** Queues a delta; schedules a coalesced flush on the next frame. */
  push: (delta: string) => void;
  /** Flushes any pending deltas synchronously (use before completion/error). */
  flush: () => void;
  /** Cancels the pending frame and discards its buffer without flushing. */
  dispose: () => void;
}

const NO_HANDLE = 0;

function defaultScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
    return {
      schedule: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
  }

  return {
    schedule: (callback) => setTimeout(callback, 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  };
}

export function createAssistantDeltaBuffer(options: AssistantDeltaBufferOptions): AssistantDeltaBuffer {
  if (typeof options.onFlush !== "function") {
    throw new Error("createAssistantDeltaBuffer requires an onFlush callback");
  }

  const scheduler = options.scheduler ?? defaultScheduler();
  const pending: string[] = [];
  let frameHandle = NO_HANDLE;

  function drain(): void {
    frameHandle = NO_HANDLE;
    if (pending.length === 0) return;
    const coalesced = pending.join("");
    pending.length = 0;
    options.onFlush(coalesced);
  }

  function cancelFrame(): void {
    if (frameHandle === NO_HANDLE) return;
    scheduler.cancel(frameHandle);
    frameHandle = NO_HANDLE;
  }

  return {
    push(delta: string): void {
      if (typeof delta !== "string" || delta === "") return;
      pending.push(delta);
      if (frameHandle === NO_HANDLE) {
        frameHandle = scheduler.schedule(drain);
      }
    },
    flush(): void {
      cancelFrame();
      drain();
    },
    dispose(): void {
      cancelFrame();
      pending.length = 0;
    },
  };
}
