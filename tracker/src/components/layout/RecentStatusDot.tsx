import { useTranslation } from "react-i18next";

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
  aborted: "bg-red-500",
};

const PULSING: ReadonlySet<RecentStatusKind> = new Set(["running", "retrying"]);

interface RecentStatusDotProps {
  statusKind: RecentStatusKind;
  className?: string;
}

export function RecentStatusDot({ statusKind, className }: RecentStatusDotProps) {
  const { t } = useTranslation();
  const label = t(`layout.recents.status.${statusKind}`);
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
