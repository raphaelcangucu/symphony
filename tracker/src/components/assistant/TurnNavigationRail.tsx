import { useState } from "react";

import type { TurnNavigationItem } from "@/components/assistant/turnNavigation";
import { cn } from "@/lib/utils";

interface TurnNavigationRailProps {
  items: readonly TurnNavigationItem[];
}

function preview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

export function TurnNavigationRail({ items }: TurnNavigationRailProps) {
  const [activeId, setActiveId] = useState(items.at(-1)?.id ?? null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Conversation turns"
      className="sticky top-4 z-20 flex w-9 shrink-0 flex-col items-start gap-1.5 self-start py-1"
    >
      {items.map((item, index) => {
        const active = item.id === activeId;
        return (
          <div key={item.id} className="group relative flex h-2.5 items-center">
            <button
              type="button"
              aria-label={`Go to turn ${index + 1}`}
              aria-current={active ? "step" : undefined}
              className={cn(
                "h-px rounded-full bg-muted-foreground/45 transition-all hover:h-0.5 hover:w-7 focus-visible:h-0.5 focus-visible:w-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "w-7 bg-foreground" : index % 4 === 0 ? "w-5" : "w-3",
              )}
              onMouseEnter={() => setPreviewId(item.id)}
              onMouseLeave={() => setPreviewId(null)}
              onFocus={() => setPreviewId(item.id)}
              onBlur={() => setPreviewId(null)}
              onClick={() => {
                setActiveId(item.id);
                document.getElementById(item.anchorId)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            />
            {previewId === item.id ? (
              <div className="pointer-events-none absolute left-8 top-1/2 w-72 -translate-y-1/2 rounded-xl border border-border/70 bg-popover p-3 text-left shadow-xl">
                <p className="line-clamp-2 text-xs font-medium text-popover-foreground">
                  {preview(item.prompt)}
                </p>
                {item.responsePreview ? (
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {preview(item.responsePreview)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
