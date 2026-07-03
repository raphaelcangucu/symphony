import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";

const STATUS_CLASS: Record<AgentExecutionStatus, string> = {
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  retrying: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  waiting: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  idle: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  saved: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  aborted: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function SessionStatusBadge({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_CLASS[status],
      )}
    >
      {t(`sessions.status.${status}`)}
    </span>
  );
}
