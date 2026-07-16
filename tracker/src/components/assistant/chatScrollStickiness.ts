import type { MutableRefObject } from "react";

import type { AssistantChatMessage } from "@/services/assistant";

export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export function attachChatScrollStickiness(
  scroller: HTMLDivElement,
  stickToBottomRef: MutableRefObject<boolean>,
  pinnedScrollTopRef: MutableRefObject<number | null>,
  onAtBottomChange?: (atBottom: boolean) => void,
): () => void {
  const updateStickinessFromScroll = () => {
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    pinnedScrollTopRef.current = atBottom ? null : scroller.scrollTop;
    onAtBottomChange?.(atBottom);
  };

  /**
   * Content growth (new message / streaming) must not flip stickiness off.
   * While stuck, keep the viewport pinned to the bottom as height increases.
   */
  const followContentGrowth = () => {
    if (!stickToBottomRef.current) {
      updateStickinessFromScroll();
      return;
    }

    pinnedScrollTopRef.current = null;
    onAtBottomChange?.(true);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
  };

  const detachFromBottom = () => {
    stickToBottomRef.current = false;
    pinnedScrollTopRef.current = scroller.scrollTop;
    // Stop an in-flight smooth scroll by pinning the current position.
    scroller.scrollTo({ top: scroller.scrollTop, behavior: "auto" });
    onAtBottomChange?.(false);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) detachFromBottom();
  };

  let touchStartY: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (touchStartY != null && y != null && y - touchStartY > 8) detachFromBottom();
  };

  updateStickinessFromScroll();
  scroller.addEventListener("scroll", updateStickinessFromScroll, { passive: true });
  scroller.addEventListener("wheel", onWheel, { passive: true });
  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: true });

  const content = scroller.firstElementChild;
  const resizeObserver = content ? new ResizeObserver(followContentGrowth) : null;
  if (content) resizeObserver?.observe(content);

  return () => {
    scroller.removeEventListener("scroll", updateStickinessFromScroll);
    scroller.removeEventListener("wheel", onWheel);
    scroller.removeEventListener("touchstart", onTouchStart);
    scroller.removeEventListener("touchmove", onTouchMove);
    resizeObserver?.disconnect();
  };
}

export type PendingScrollRestore = {
  prevScrollHeight: number;
  prevScrollTop: number;
};

/**
 * Capture scroll metrics before prepending content above the viewport.
 * Detaches stick-to-bottom so ResizeObserver growth-follow cannot jump to the
 * new bottom while older messages are revealed.
 */
export function captureScrollBeforePrepend(
  scroller: HTMLDivElement | null,
  stickToBottomRef: MutableRefObject<boolean>,
  pinnedScrollTopRef: MutableRefObject<number | null>,
): PendingScrollRestore | null {
  if (!scroller) return null;

  stickToBottomRef.current = false;
  // Clear the absolute pin so layout effects do not restore a stale scrollTop
  // before height-delta restoration runs.
  pinnedScrollTopRef.current = null;

  return {
    prevScrollHeight: scroller.scrollHeight,
    prevScrollTop: scroller.scrollTop,
  };
}

/** Restore the pre-prepend viewport after DOM height has grown above it. */
export function restoreScrollAfterPrepend(
  scroller: HTMLDivElement | null,
  pending: PendingScrollRestore | null,
  pinnedScrollTopRef: MutableRefObject<number | null>,
): void {
  if (!scroller || !pending) return;

  const nextTop = pending.prevScrollTop + (scroller.scrollHeight - pending.prevScrollHeight);
  scroller.scrollTop = nextTop;
  pinnedScrollTopRef.current = nextTop;
}

export function setMessagesPreservingScroll(
  scroller: HTMLDivElement | null,
  stickToBottomRef: MutableRefObject<boolean>,
  pinnedScrollTopRef: MutableRefObject<number | null>,
  history: AssistantChatMessage[],
  setMessages: (messages: AssistantChatMessage[]) => void,
) {
  const pending = captureScrollBeforePrepend(scroller, stickToBottomRef, pinnedScrollTopRef);
  setMessages(history);
  if (!scroller || !pending) return;

  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    restoreScrollAfterPrepend(scroller, pending, pinnedScrollTopRef);
  });
}
