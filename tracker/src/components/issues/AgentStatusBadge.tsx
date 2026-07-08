import { AlertCircle, Ban, Clock, Moon, Pause, RotateCcw, Target, Zap, type LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { i18n } from "@/i18n";
import { longRunningBadgeText } from "@/lib/agentExecutionDisplay";
import { statusToneBadgeClass, statusToneDotClass, type StatusTone } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentExecutionStatus } from "@/types/agent-execution";

interface AgentStatusMeta {
  labelKey: string;
  Icon: LucideIcon;
  tone: StatusTone;
  pulse: boolean;
  spin: boolean;
}

const AGENT_STATUS_META: Record<AgentExecutionStatus, AgentStatusMeta> = {
  live: { labelKey: "issue.agent.executionStatus.live", Icon: Zap, tone: "success", pulse: true, spin: false },
  idle: { labelKey: "issue.agent.executionStatus.idle", Icon: Moon, tone: "neutral", pulse: false, spin: false },
  waiting: { labelKey: "issue.agent.executionStatus.waiting", Icon: Clock, tone: "warning", pulse: true, spin: false },
  retrying: {
    labelKey: "issue.agent.executionStatus.retrying",
    Icon: RotateCcw,
    tone: "attention",
    pulse: false,
    spin: true,
  },
  error: { labelKey: "issue.agent.executionStatus.error", Icon: AlertCircle, tone: "destructive", pulse: false, spin: false },
  aborted: { labelKey: "issue.agent.executionStatus.aborted", Icon: Ban, tone: "destructive", pulse: false, spin: false },
  saved: { labelKey: "issue.agent.executionStatus.saved", Icon: Target, tone: "highlight", pulse: false, spin: false },
  paused: { labelKey: "issue.agent.executionStatus.paused", Icon: Pause, tone: "accent", pulse: false, spin: false },
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
        <span
          className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", statusToneDotClass(meta.tone))}
        />
      ) : null}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", statusToneDotClass(meta.tone))} />
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
        statusToneBadgeClass(meta.tone),
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
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        statusToneBadgeClass("highlight"),
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <Target className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {text}
    </span>
  );
}
