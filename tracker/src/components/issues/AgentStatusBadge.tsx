import { AlertCircle, Ban, Clock, Moon, Pause, RotateCcw, Target, Zap, type LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { i18n } from "@/i18n";
import { longRunningBadgeText } from "@/lib/agentExecutionDisplay";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentExecutionStatus } from "@/types/agent-execution";

interface AgentStatusMeta {
  labelKey: string;
  Icon: LucideIcon;
  dotClass: string;
  textClass: string;
  chipClass: string;
  pulse: boolean;
  spin: boolean;
}

const AGENT_STATUS_META: Record<AgentExecutionStatus, AgentStatusMeta> = {
  live: {
    labelKey: "issue.agent.executionStatus.live",
    Icon: Zap,
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-300",
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    pulse: true,
    spin: false,
  },
  idle: {
    labelKey: "issue.agent.executionStatus.idle",
    Icon: Moon,
    dotClass: "bg-slate-400",
    textClass: "text-slate-500 dark:text-slate-300",
    chipClass: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
    pulse: false,
    spin: false,
  },
  waiting: {
    labelKey: "issue.agent.executionStatus.waiting",
    Icon: Clock,
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-300",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    pulse: true,
    spin: false,
  },
  retrying: {
    labelKey: "issue.agent.executionStatus.retrying",
    Icon: RotateCcw,
    dotClass: "bg-orange-500",
    textClass: "text-orange-600 dark:text-orange-300",
    chipClass: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300",
    pulse: false,
    spin: true,
  },
  error: {
    labelKey: "issue.agent.executionStatus.error",
    Icon: AlertCircle,
    dotClass: "bg-rose-500",
    textClass: "text-rose-600 dark:text-rose-300",
    chipClass: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
    pulse: false,
    spin: false,
  },
  aborted: {
    labelKey: "issue.agent.executionStatus.aborted",
    Icon: Ban,
    dotClass: "bg-rose-400",
    textClass: "text-rose-500 dark:text-rose-300",
    chipClass: "border-rose-400/30 bg-rose-400/10 text-rose-500 dark:text-rose-300",
    pulse: false,
    spin: false,
  },
  saved: {
    labelKey: "issue.agent.executionStatus.saved",
    Icon: Target,
    dotClass: "bg-violet-400",
    textClass: "text-violet-600 dark:text-violet-300",
    chipClass: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
    pulse: false,
    spin: false,
  },
  paused: {
    labelKey: "issue.agent.executionStatus.paused",
    Icon: Pause,
    dotClass: "bg-sky-400",
    textClass: "text-sky-600 dark:text-sky-300",
    chipClass: "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
    pulse: false,
    spin: false,
  },
};

type Translate = TFunction;

export function agentStatusLabel(
  status: AgentExecutionStatus,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  return t(AGENT_STATUS_META[status].labelKey);
}

interface AgentStatusDotProps {
  status: AgentExecutionStatus;
  className?: string;
}

export function AgentStatusDot({ status, className }: AgentStatusDotProps) {
  const { t } = useTranslation();
  const meta = AGENT_STATUS_META[status];
  const label = agentStatusLabel(status, t);
  return (
    <span title={t("board.issueCard.agentStatus", { status: label })} className={cn("relative inline-flex h-2.5 w-2.5", className)}>
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
  const { t } = useTranslation();
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
      {agentStatusLabel(status, t)}
    </span>
  );
}

interface AgentLongRunningBadgeProps {
  execution: AgentExecution;
  className?: string;
  compact?: boolean;
}

export function AgentLongRunningBadge({ execution, className, compact = false }: AgentLongRunningBadgeProps) {
  const { t } = useTranslation();
  if (!execution.longRunning) return null;

  const text = longRunningBadgeText(execution, t);
  if (!text) return null;

  return (
    <span
      title={execution.goal?.objective ?? text}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <Target className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {text}
    </span>
  );
}
