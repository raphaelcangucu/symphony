import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getStatusMeta } from "@/components/board/status-meta";
import { cn } from "@/lib/utils";
import type { WorkflowStatusName } from "@/types/workflow-status";

interface InlineStatusEditorProps {
  status: WorkflowStatusName;
  options: readonly WorkflowStatusName[];
  disabled?: boolean;
  saving?: boolean;
  onSave: (status: WorkflowStatusName) => Promise<boolean>;
}

export function InlineStatusEditor({
  status,
  options,
  disabled = false,
  saving = false,
  onSave,
}: InlineStatusEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorkflowStatusName>(status);
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = getStatusMeta(status);
  const StatusIcon = meta.Icon;

  useEffect(() => {
    if (!open) setDraft(status);
  }, [open, status]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  async function commit(next: WorkflowStatusName) {
    if (next === status) {
      setOpen(false);
      return;
    }
    const saved = await onSave(next);
    if (saved) setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs font-medium">
          <StatusIcon className={cn("h-3.5 w-3.5", meta.iconClass)} />
          {status}
        </span>
        {!disabled ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 min-w-[220px] overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {options.map((option) => {
              const optionMeta = getStatusMeta(option);
              const OptionIcon = optionMeta.Icon;
              const active = draft === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDraft(option)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <OptionIcon className={cn("h-3.5 w-3.5 shrink-0", optionMeta.iconClass)} />
                  <span className="flex-1">{option}</span>
                  {active ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2">
            <button
              type="button"
              disabled={saving || draft === status}
              onClick={() => void commit(draft)}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
