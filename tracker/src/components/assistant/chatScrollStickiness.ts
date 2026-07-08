import type { MutableRefObject } from "react";

import type { AssistantChatMessage } from "@/services/assistant";

export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export function attachChatScrollStickiness(
  scroller: HTMLDivElement,
  stickToBottomRef: MutableRefObject<boolean>,
  pinnedScrollTopRef: MutableRefObject<number | null>,
  onAtBottomChange?: (atBottom: boolean) => void,
): () => void {
  const updateStickiness = () => {
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    pinnedScrollTopRef.current = atBottom ? null : scroller.scrollTop;
    onAtBottomChange?.(atBottom);
  };

  const detachFromBottom = () => {
    stickToBottomRef.current = false;
    pinnedScrollTopRef.current = scroller.scrollTop;
    // Stop an in-flight smooth scroll by pinning the current position.
    scroller.scrollTo({ top: scroller.scrollTop, behavior: "auto" });
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

  updateStickiness();
  scroller.addEventListener("scroll", updateStickiness, { passive: true });
  scroller.addEventListener("wheel", onWheel, { passive: true });
  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: true });

  const content = scroller.firstElementChild;
  const resizeObserver = content ? new ResizeObserver(updateStickiness) : null;
  if (content) resizeObserver?.observe(content);

  return () => {
    scroller.removeEventListener("scroll", updateStickiness);
    scroller.removeEventListener("wheel", onWheel);
    scroller.removeEventListener("touchstart", onTouchStart);
    scroller.removeEventListener("touchmove", onTouchMove);
    resizeObserver?.disconnect();
  };
}

export function setMessagesPreservingScroll(
  scroller: HTMLDivElement | null,
  stickToBottomRef: MutableRefObject<boolean>,
  history: AssistantChatMessage[],
  setMessages: (messages: AssistantChatMessage[]) => void,
) {
  if (scroller && !stickToBottomRef.current) {
    const prevScrollHeight = scroller.scrollHeight;
    const prevScrollTop = scroller.scrollTop;
    setMessages(history);
    requestAnimationFrame(() => {
      if (!scroller.isConnected) return;
      scroller.scrollTop = prevScrollTop + (scroller.scrollHeight - prevScrollHeight);
    });
    return;
  }

  setMessages(history);
}
