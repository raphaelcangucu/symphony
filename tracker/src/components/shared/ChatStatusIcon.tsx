import { MessageSquare, PenLine, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { RecentScope, RecentStatusKind } from "@/types/recents";
import type { SidebarAggregateStatus } from "@/types/sidebar";

/** Shared session glyph + agent-status bolinha used by sidebar and Workspaces. */
export const CHAT_STATUS_ICON_SIZE = "h-3 w-3";
export const CHAT_STATUS_DOT_SIZE = "h-1.5 w-1.5";
export const CHAT_STATUS_STROKE = 2;

export type SessionStatusIconKind = "chat" | "execution" | "authoring";
/** Agent lifecycle on the session glyph — not chat "active"/unread. */
export type SessionAgentStatus = "idle" | "running" | "attention";

const KIND_ICON: Readonly<Record<SessionStatusIconKind, LucideIcon>> = {
  execution: Zap,
  authoring: PenLine,
  chat: MessageSquare,
};

const KIND_BADGE: Readonly<Record<SessionStatusIconKind, string>> = {
  execution: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  authoring: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  chat: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
};

const AGENT_DOT: Readonly<Record<SessionAgentStatus, string>> = {
  idle: "bg-slate-400",
  running: "bg-emerald-500 animate-pulse",
  attention: "bg-orange-500",
};

const RUNNING_STATUS_KINDS = new Set<string>(["live", "running", "in_progress"]);
const ATTENTION_STATUS_KINDS = new Set<string>([
  "waiting",
  "retrying",
  "error",
  "aborted",
  "paused",
  "review",
]);

interface ChatStatusIconProps {
  sessionKind?: SessionStatusIconKind | null;
  /** Prefer aggregate + needsReview; statusKind is a legacy fallback. */
  statusKind?: RecentStatusKind | null;
  aggregateStatus?: SidebarAggregateStatus | null;
  needsAttention?: boolean;
  executionStatus?: AgentExecutionStatus | null;
  className?: string;
}

export function sessionStatusIconKindFromScope(
  scope: RecentScope | null | undefined,
): SessionStatusIconKind {
  switch (scope) {
    case "issue_execution":
      return "execution";
    case "issue":
      return "authoring";
    case "issue_session":
    default:
      return "chat";
  }
}

export function resolveSessionAgentStatus(input: {
  executionStatus?: AgentExecutionStatus | null;
  aggregateStatus?: SidebarAggregateStatus | null;
  statusKind?: RecentStatusKind | string | null;
  needsAttention?: boolean;
}): SessionAgentStatus {
  if (input.needsAttention) return "attention";

  const execution = input.executionStatus?.trim().toLowerCase() ?? "";
  if (execution === "live" || execution === "retrying") return "running";
  if (
    execution === "waiting" ||
    execution === "error" ||
    execution === "aborted" ||
    execution === "paused"
  ) {
    return "attention";
  }
  if (execution === "idle" || execution === "saved") return "idle";

  const aggregate = input.aggregateStatus?.trim().toLowerCase() ?? "";
  if (aggregate === "attention" || aggregate === "error") return "attention";
  // Do not treat aggregate "active" as running — chat threads often land there
  // when the agent is idle. Only explicit live/running signals count.

  const status = input.statusKind?.trim().toLowerCase() ?? "";
  if (RUNNING_STATUS_KINDS.has(status)) return "running";
  if (ATTENTION_STATUS_KINDS.has(status)) return "attention";
  return "idle";
}

export function ChatStatusIcon({
  sessionKind = "chat",
  statusKind = null,
  aggregateStatus = null,
  needsAttention = false,
  executionStatus = null,
  className,
}: ChatStatusIconProps) {
  const { t } = useTranslation();
  const kind = sessionKind ?? "chat";
  const Icon = KIND_ICON[kind];
  const agentStatus = resolveSessionAgentStatus({
    executionStatus,
    aggregateStatus,
    statusKind,
    needsAttention,
  });
  const statusLabel = t(`layout.sidebar.tree.agentStatus.${agentStatus}`, {
    defaultValue: agentStatusDefault(agentStatus),
  });

  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        KIND_BADGE[kind],
        className,
      )}
      title={statusLabel}
    >
      <Icon
        aria-hidden="true"
        className={CHAT_STATUS_ICON_SIZE}
        strokeWidth={CHAT_STATUS_STROKE}
      />
      <span
        role="img"
        aria-label={statusLabel}
        className={cn(
          "absolute -right-0.5 -top-0.5 inline-block rounded-full ring-1 ring-background",
          CHAT_STATUS_DOT_SIZE,
          AGENT_DOT[agentStatus],
        )}
      />
    </span>
  );
}

function agentStatusDefault(status: SessionAgentStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "attention":
      return "Needs attention";
    case "idle":
    default:
      return "Idle";
  }
}
