import type { TFunction } from "i18next";
import { AlertTriangle } from "lucide-react";

import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { IssuePriority } from "@/types/issue";

interface PriorityMeta {
  labelKey: string;
  filledBars: number;
  urgent: boolean;
}

const PRIORITY_META: Record<IssuePriority, PriorityMeta> = {
  0: { labelKey: "issue.priority.none", filledBars: 0, urgent: false },
  1: { labelKey: "issue.priority.urgent", filledBars: 3, urgent: true },
  2: { labelKey: "issue.priority.high", filledBars: 3, urgent: false },
  3: { labelKey: "issue.priority.medium", filledBars: 2, urgent: false },
  4: { labelKey: "issue.priority.low", filledBars: 1, urgent: false },
};

type Translate = TFunction;

export function priorityLabel(
  priority: IssuePriority | null,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  if (priority === null) return t("issue.priority.none");
  return t(PRIORITY_META[priority].labelKey);
}

interface PriorityIndicatorProps {
  priority: IssuePriority | null;
  className?: string;
}

const BAR_HEIGHTS = ["h-[5px]", "h-[9px]", "h-[13px]"] as const;

export function PriorityIndicator({ priority, className }: PriorityIndicatorProps) {
  if (priority === null) return null;
  const meta = PRIORITY_META[priority];
  const label = priorityLabel(priority);

  if (meta.urgent) {
    return (
      <span
        title={label}
        className={cn("inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-orange-500 text-white", className)}
      >
        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span title={label} className={cn("inline-flex h-4 w-4 items-end justify-center gap-[2px]", className)}>
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

export function priorityOptions(t: Translate = i18n.t.bind(i18n) as Translate): Array<{
  value: IssuePriority | null;
  label: string;
}> {
  return [
    { value: null, label: t("issue.priority.none") },
    { value: 1, label: t("issue.priority.urgent") },
    { value: 2, label: t("issue.priority.high") },
    { value: 3, label: t("issue.priority.medium") },
    { value: 4, label: t("issue.priority.low") },
  ];
}
