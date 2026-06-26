import type { Editor } from "@tiptap/react";
import { ListTree } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { type KbHeading, useKbHeadings } from "./useKbHeadings";

interface Props {
  editor: Editor;
  /** The `.kb-editor` overflow container; used as the scroll/observer context. */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

const HEADING_SELECTOR = ".kb-prose h1, .kb-prose h2, .kb-prose h3";
// Left padding applied per heading level so the outline reads as a hierarchy.
const INDENT_BY_LEVEL: Record<KbHeading["level"], string> = {
  1: "",
  2: "pl-6",
  3: "pl-10",
};
// The active heading is the last one whose top has crossed this fraction of the
// scroll container height, matching the "reading line" used by the Tiptap demo.
const ACTIVE_LINE_RATIO = 0.3;

function resolveHeadingElement(editor: Editor, pos: number): HTMLElement | null {
  const direct = editor.view.nodeDOM(pos);
  if (direct instanceof HTMLElement) return direct;
  const resolved = editor.view.domAtPos(pos + 1).node;
  if (resolved instanceof HTMLElement) return resolved;
  return resolved?.parentElement ?? null;
}

export function KbTableOfContents({ editor, scrollContainerRef }: Props) {
  const { t } = useTranslation();
  const headings = useKbHeadings(editor);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const computeActive = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
    if (elements.length === 0) return;
    const containerTop = container.getBoundingClientRect().top;
    const line = container.clientHeight * ACTIVE_LINE_RATIO;
    let active = 0;
    for (let index = 0; index < elements.length; index += 1) {
      const relativeTop = elements[index].getBoundingClientRect().top - containerTop;
      if (relativeTop <= line) active = index;
      else break;
    }
    setActiveIndex(active);
  }, [scrollContainerRef]);

  // Track the active section live while the panel is open. The observer fires on
  // every band crossing as the user scrolls; the actual active index is derived
  // geometrically so positions between headings still resolve correctly.
  useEffect(() => {
    if (!open) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
    if (elements.length === 0) return;

    computeActive();
    const observer = new IntersectionObserver(() => computeActive(), {
      root: container,
      rootMargin: "0px 0px -70% 0px",
      threshold: [0, 1],
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [open, headings, scrollContainerRef, computeActive]);

  // Close on outside click or Escape. Scrolling the document must NOT close the
  // panel, so we only listen for pointerdown/Escape (mirrors KbBlockHandle).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const goTo = useCallback(
    (heading: KbHeading) => {
      const element = resolveHeadingElement(editor, heading.pos);
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
      // Move the selection without focusing so the panel keeps DOM focus and the
      // editor does not steal the scroll we just performed.
      editor.chain().setTextSelection(heading.pos + 1).run();
    },
    [editor],
  );

  if (headings.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("kb.editor.toc.button")}
        title={t("kb.editor.toc.button")}
        aria-pressed={open}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
          open
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <ListTree className="h-3.5 w-3.5" />
        {t("kb.editor.toc.button")}
      </button>

      {open ? (
        <nav
          aria-label={t("kb.editor.toc.label")}
          className="absolute right-0 top-full z-50 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md scrollbar-discrete"
        >
          {headings.map((heading, index) => (
            <button
              key={heading.pos}
              type="button"
              data-level={heading.level}
              aria-current={index === activeIndex ? "location" : undefined}
              onClick={() => goTo(heading)}
              className={cn(
                "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent",
                INDENT_BY_LEVEL[heading.level],
                index === activeIndex ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {heading.text || (
                <span className="italic text-muted-foreground">{t("kb.editor.toc.untitled")}</span>
              )}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
