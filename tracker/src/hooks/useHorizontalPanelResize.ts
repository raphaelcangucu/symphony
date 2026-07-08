import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 288;
const MAX_WIDTH_RATIO = 0.75;

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

interface UseHorizontalPanelResizeOptions {
  containerRef: RefObject<HTMLElement | null>;
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidthRatio?: number;
  enabled?: boolean;
}

function readStoredWidth(storageKey: string | undefined, fallback: number): number {
  if (!storageKey || typeof window === "undefined") return fallback;

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH ? parsed : fallback;
}

function clampWidth(width: number, containerWidth: number, minWidth: number, maxWidthRatio: number): number {
  const maxWidth = Math.max(minWidth, Math.floor(containerWidth * maxWidthRatio));
  return Math.min(Math.max(width, minWidth), maxWidth);
}

export function useHorizontalPanelResize({
  containerRef,
  storageKey,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidthRatio = MAX_WIDTH_RATIO,
  enabled = true,
}: UseHorizontalPanelResizeOptions) {
  const dragRef = useRef<DragState | null>(null);
  const widthRef = useRef(readStoredWidth(storageKey, defaultWidth));
  const [width, setWidth] = useState(widthRef.current);
  const [isResizing, setIsResizing] = useState(false);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      widthRef.current = nextWidth;
      setWidth(nextWidth);
      if (storageKey) {
        window.localStorage.setItem(storageKey, String(nextWidth));
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    persistWidth(clampWidth(widthRef.current, container.clientWidth, minWidth, maxWidthRatio));
  }, [containerRef, enabled, maxWidthRatio, minWidth, persistWidth]);

  useEffect(() => {
    if (!enabled || !isResizing) return;

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragRef.current;
      const container = containerRef.current;
      if (!dragState || !container || dragState.pointerId !== event.pointerId) return;

      const delta = dragState.startX - event.clientX;
      const nextWidth = clampWidth(
        dragState.startWidth + delta,
        container.clientWidth,
        minWidth,
        maxWidthRatio,
      );
      widthRef.current = nextWidth;
      setWidth(nextWidth);
    }

    function finishResize(event: PointerEvent) {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragRef.current = null;
      setIsResizing(false);
      if (storageKey) {
        window.localStorage.setItem(storageKey, String(widthRef.current));
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [containerRef, enabled, isResizing, maxWidthRatio, minWidth, storageKey]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled) return;

      event.preventDefault();
      event.stopPropagation();

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: widthRef.current,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
    },
    [enabled],
  );

  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled) return;

      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsResizing(false);
      if (storageKey) {
        window.localStorage.setItem(storageKey, String(widthRef.current));
      }
    },
    [enabled, storageKey],
  );

  return {
    width,
    isResizing,
    onResizePointerDown,
    onResizePointerUp,
  };
}
