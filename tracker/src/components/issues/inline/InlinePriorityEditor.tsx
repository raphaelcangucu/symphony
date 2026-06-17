import { useCallback, useEffect, useRef, useState } from "react";

import { PriorityIndicator, priorityLabel } from "@/components/issues/PriorityIndicator";
import { cn } from "@/lib/utils";
import type { IssuePriority } from "@/types/issue";

const PRIORITY_OPTIONS: Array<{ value: IssuePriority | null; label: string }> = [
  { value: null, label: "No priority" },
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
];

interface InlinePriorityEditorProps {
  priority: IssuePriority | null;
  disabled?: boolean;
  saving?: boolean;
  onSave: (priority: IssuePriority | null) => Promise<boolean>;
}

export function InlinePriorityEditor({
  priority,
  disabled = false,
  saving = false,
  onSave,
}: InlinePriorityEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IssuePriority | null>(priority);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setDraft(priority);
  }, [open, priority]);

  const commit = useCallback(async () => {
    if (draft === priority) {
      setOpen(false);
      return;
    }
    const saved = await onSave(draft);
    if (saved) setOpen(false);
  }, [draft, onSave, priority]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        void commit();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [commit, open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => {
          if (open) {
            void commit();
          } else {
            setOpen(true);
          }
        }}
        className={cn(
          "group inline-flex w-full items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <PriorityIndicator priority={priority} />
        <span className="text-sm">{priorityLabel(priority)}</span>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Priority
          </div>
          <div className="space-y-0.5">
            {PRIORITY_OPTIONS.map((option) => {
              const active = draft === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDraft(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <PriorityIndicator priority={option.value} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
