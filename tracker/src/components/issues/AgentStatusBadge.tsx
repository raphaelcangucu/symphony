import { Clock, Moon, RotateCcw, Target, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentExecutionStatus } from "@/types/agent-execution";

interface AgentStatusMeta {
  label: string;
  Icon: LucideIcon;
  dotClass: string;
  textClass: string;
  chipClass: string;
  pulse: boolean;
  spin: boolean;
}

const AGENT_STATUS_META: Record<AgentExecutionStatus, AgentStatusMeta> = {
  live: {
    label: "Live",
    Icon: Zap,
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-300",
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    pulse: true,
    spin: false,
  },
  idle: {
    label: "Idle",
    Icon: Moon,
    dotClass: "bg-slate-400",
    textClass: "text-slate-500 dark:text-slate-300",
    chipClass: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
    pulse: false,
    spin: false,
  },
  waiting: {
    label: "Waiting",
    Icon: Clock,
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-300",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    pulse: true,
    spin: false,
  },
  retrying: {
    label: "Retrying",
    Icon: RotateCcw,
    dotClass: "bg-orange-500",
    textClass: "text-orange-600 dark:text-orange-300",
    chipClass: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300",
    pulse: false,
    spin: true,
  },
};

export function agentStatusLabel(status: AgentExecutionStatus): string {
  return AGENT_STATUS_META[status].label;
}

interface AgentStatusDotProps {
  status: AgentExecutionStatus;
  className?: string;
}

export function AgentStatusDot({ status, className }: AgentStatusDotProps) {
  const meta = AGENT_STATUS_META[status];
  return (
    <span title={`Agent: ${meta.label}`} className={cn("relative inline-flex h-2.5 w-2.5", className)}>
      {meta.pulse ? (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", meta.dotClass)} />
      ) : null}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", meta.dotClass)} />
    </span>
  );
}

interface AgentStatusBadgeProps {
  status: AgentExecutionStatus;
  className?: string;
  showIcon?: boolean;
}

export function AgentStatusBadge({ status, className, showIcon = true }: AgentStatusBadgeProps) {
  const meta = AGENT_STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        meta.chipClass,
        className,
      )}
    >
      {showIcon ? <Icon className={cn("h-3 w-3", meta.spin && "animate-spin")} /> : null}
      {meta.label}
    </span>
  );
}

interface AgentLongRunningBadgeProps {
  execution: AgentExecution;
  className?: string;
  compact?: boolean;
}

export function AgentLongRunningBadge({ execution, className, compact = false }: AgentLongRunningBadgeProps) {
  if (!execution.longRunning || !execution.longRunningLabel) return null;

  const status = execution.goal?.status;
  const statusSuffix = status && status !== "active" ? ` (${status})` : "";

  return (
    <span
      title={execution.goal?.objective ?? execution.longRunningLabel}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <Target className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {execution.longRunningLabel}
      {statusSuffix}
    </span>
  );
}
