import { X } from "lucide-react";
import { type PointerEvent, type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  bringFloatingSurfaceToFront,
  closeFloatingSurface,
  updateFloatingSurfaceBounds,
  type FloatingSurface,
} from "@/stores/floatingSurfaceStore";

interface FloatingSurfaceWindowProps {
  surface: FloatingSurface;
  children: ReactNode;
}

interface PointerOrigin {
  pointerId: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function FloatingSurfaceWindow({ surface, children }: FloatingSurfaceWindowProps) {
  const { t } = useTranslation();
  const dragOriginRef = useRef<PointerOrigin | null>(null);
  const resizeOriginRef = useRef<PointerOrigin | null>(null);

  function createPointerOrigin(event: PointerEvent<HTMLElement>): PointerOrigin {
    return {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      ...surface.bounds,
    };
  }

  function handleDragPointerDown(event: PointerEvent<HTMLDivElement>) {
    bringFloatingSurfaceToFront(surface.id);
    if (event.target instanceof Element && event.target.closest("button")) return;

    dragOriginRef.current = createPointerOrigin(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDragPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    updateFloatingSurfaceBounds(surface.id, {
      x: origin.x + event.clientX - origin.clientX,
      y: origin.y + event.clientY - origin.clientY,
      width: origin.width,
      height: origin.height,
    });
  }

  function clearDragOrigin(event: PointerEvent<HTMLDivElement>) {
    if (dragOriginRef.current?.pointerId !== event.pointerId) return;
    dragOriginRef.current = null;
  }

  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    bringFloatingSurfaceToFront(surface.id);
    resizeOriginRef.current = createPointerOrigin(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = resizeOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    updateFloatingSurfaceBounds(surface.id, {
      x: origin.x,
      y: origin.y,
      width: origin.width + event.clientX - origin.clientX,
      height: origin.height + event.clientY - origin.clientY,
    });
  }

  function clearResizeOrigin(event: PointerEvent<HTMLDivElement>) {
    if (resizeOriginRef.current?.pointerId !== event.pointerId) return;
    resizeOriginRef.current = null;
  }

  return (
    <section
      className="absolute flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
      data-testid="floating-surface"
      style={{
        left: surface.bounds.x,
        top: surface.bounds.y,
        width: surface.bounds.width,
        height: surface.bounds.height,
        zIndex: surface.zIndex,
      }}
    >
      <div
        aria-label={t("floatingSurface.dragHandleAria")}
        className="flex shrink-0 cursor-move touch-none items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2"
        onPointerCancel={clearDragOrigin}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={clearDragOrigin}
      >
        <span className="min-w-0 truncate text-sm font-medium">{surface.title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={t("floatingSurface.close")}
          onClick={() => closeFloatingSurface(surface.id)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <div
        aria-hidden="true"
        className={cn(
          "absolute bottom-0 right-0 h-4 w-4 cursor-se-resize touch-none",
          "before:absolute before:bottom-1 before:right-1 before:h-2 before:w-2 before:border-b before:border-r before:border-muted-foreground/60",
        )}
        onPointerCancel={clearResizeOrigin}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={clearResizeOrigin}
      />
    </section>
  );
}
