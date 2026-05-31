import { cn } from "@/lib/utils";
import type { RecentStatusKind } from "@/types/recents";

const STATUS_COLORS: Record<RecentStatusKind, string> = {
  running: "bg-emerald-500",
  waiting: "bg-amber-500",
  retrying: "bg-orange-500",
  idle: "bg-slate-400",
  active: "bg-sky-500",
  in_progress: "bg-blue-500",
  todo: "bg-slate-400",
  done: "bg-emerald-600",
  closed: "bg-slate-500",
  error: "bg-red-500",
};

const PULSING: ReadonlySet<RecentStatusKind> = new Set(["running", "retrying"]);

const STATUS_LABELS: Record<RecentStatusKind, string> = {
  running: "Running",
  waiting: "Waiting",
  retrying: "Retrying",
  idle: "Idle",
  active: "Active",
  in_progress: "In progress",
  todo: "To do",
  done: "Done",
  closed: "Closed",
  error: "Error",
};

interface RecentStatusDotProps {
  statusKind: RecentStatusKind;
  className?: string;
}

export function RecentStatusDot({ statusKind, className }: RecentStatusDotProps) {
  const label = STATUS_LABELS[statusKind];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        STATUS_COLORS[statusKind],
        PULSING.has(statusKind) && "animate-pulse",
        className,
      )}
    />
  );
}
