import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { getTextareaCaretRect, type TextareaCaretRect } from "@/lib/textareaCaret";
import { cn } from "@/lib/utils";
import type { IssueAssigneeOption } from "@/types/issue";

interface MentionAutocompleteProps {
  open: boolean;
  options: IssueAssigneeOption[];
  activeIndex: number;
  onSelect: (login: string) => void;
  anchorRef: RefObject<HTMLTextAreaElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  caretIndex: number;
}

function optionLogin(option: IssueAssigneeOption): string {
  return option.login?.trim() || option.id?.trim() || "";
}

const CARET_GAP = 4;

function toContainerPosition(
  caretRect: TextareaCaretRect,
  container: HTMLElement,
): { top: number; left: number } {
  const containerRect = container.getBoundingClientRect();
  return {
    top: caretRect.top - containerRect.top + caretRect.height + CARET_GAP + container.scrollTop,
    left: caretRect.left - containerRect.left + container.scrollLeft,
  };
}

export function MentionAutocomplete({
  open,
  options,
  activeIndex,
  onSelect,
  anchorRef,
  containerRef,
  caretIndex,
}: MentionAutocompleteProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const textarea = anchorRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;

    function updatePosition() {
      const nextTextarea = anchorRef.current;
      const nextContainer = containerRef.current;
      if (!nextTextarea || !nextContainer) return;

      const caretRect = getTextareaCaretRect(nextTextarea, caretIndex);
      if (!caretRect) return;
      setPosition(toContainerPosition(caretRect, nextContainer));
    }

    updatePosition();
    textarea.addEventListener("scroll", updatePosition);
    container.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      textarea.removeEventListener("scroll", updatePosition);
      container.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, caretIndex, containerRef, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const container = containerRef.current;
  if (!open || options.length === 0 || !position || !container) return null;

  return createPortal(
    <ul
      ref={listRef}
      className={cn(
        "absolute z-50 min-w-[14rem] max-w-[min(20rem,calc(100vw-1rem))] max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md",
      )}
      style={{ top: position.top, left: position.left }}
      role="listbox"
      aria-label={t("issue.comments.mentions.listLabel")}
    >
      {options.map((option, index) => {
        const login = optionLogin(option);
        if (!login) return null;

        return (
          <li key={login}>
            <button
              type="button"
              role="option"
              data-active={index === activeIndex ? "true" : "false"}
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(login);
              }}
            >
              <AssigneeAvatar login={login} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight">{login}</span>
                {option.name ? (
                  <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
                    {option.name}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>,
    container,
  );
}
