import { useEffect, useRef, type RefObject } from "react";

interface UseInlinePickerDismissArgs {
  /** Whether the picker popover is currently open. */
  open: boolean;
  /** Container whose outside clicks dismiss the picker. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called on outside mousedown; commit or close depending on the editor. */
  onDismiss: () => void;
  /** Optional element focused (next frame) when the picker opens. */
  focusRef?: RefObject<HTMLElement | null>;
}

/**
 * Click-outside dismissal shared by the inline issue editors (status,
 * priority, assignee, label, agent, issue picker). Keeps the latest
 * `onDismiss` in a ref so the listener never re-binds mid-interaction.
 */
export function useInlinePickerDismiss({ open, containerRef, onDismiss, focusRef }: UseInlinePickerDismissArgs): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    if (focusRef) requestAnimationFrame(() => focusRef.current?.focus());
    return () => window.removeEventListener("mousedown", handlePointerDown);
    // focusRef is a stable ref object; containerRef likewise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
