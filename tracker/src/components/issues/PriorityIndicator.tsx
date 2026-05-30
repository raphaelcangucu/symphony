import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IssuePriority } from "@/types/issue";

interface PriorityMeta {
  label: string;
  filledBars: number;
  urgent: boolean;
}

const PRIORITY_META: Record<IssuePriority, PriorityMeta> = {
  0: { label: "No priority", filledBars: 0, urgent: false },
  1: { label: "Urgent", filledBars: 3, urgent: true },
  2: { label: "High", filledBars: 3, urgent: false },
  3: { label: "Medium", filledBars: 2, urgent: false },
  4: { label: "Low", filledBars: 1, urgent: false },
};

export function priorityLabel(priority: IssuePriority | null): string {
  if (priority === null) return "No priority";
  return PRIORITY_META[priority].label;
}

interface PriorityIndicatorProps {
  priority: IssuePriority | null;
  className?: string;
}

const BAR_HEIGHTS = ["h-[5px]", "h-[9px]", "h-[13px]"] as const;

export function PriorityIndicator({ priority, className }: PriorityIndicatorProps) {
  if (priority === null) return null;
  const meta = PRIORITY_META[priority];

  if (meta.urgent) {
    return (
      <span
        title={meta.label}
        className={cn("inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-orange-500 text-white", className)}
      >
        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span title={meta.label} className={cn("inline-flex h-4 w-4 items-end justify-center gap-[2px]", className)}>
      {BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className={cn(
            "w-[3px] rounded-[1px]",
            height,
            index < meta.filledBars ? "bg-foreground/80" : "bg-foreground/20",
          )}
        />
      ))}
    </span>
  );
}
