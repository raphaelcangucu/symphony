import { Activity, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { AGENT_ICONS } from "@/components/shared/AgentChip";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";
import type { RecentSession, RecentStatusKind } from "@/types/recents";

export type SessionBadgeKind = "chat" | "execution";

const AGENT_LABELS: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};

const SESSION_LABELS: Record<SessionBadgeKind, string> = {
  chat: "Chat",
  execution: "Execution",
};

const STATUS_CLASS: Record<RecentStatusKind, string> = {
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  retrying: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  waiting: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  idle: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  active: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  todo: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  aborted: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function shortAgentKindLabel(kind: AgentKind): string {
  return AGENT_LABELS[kind];
}

export function sessionKindLabel(kind: SessionBadgeKind): string {
  return SESSION_LABELS[kind];
}

export function SessionTypeBadge({ kind, className }: { kind: SessionBadgeKind; className?: string }) {
  const label = sessionKindLabel(kind);
  const Icon = kind === "execution" ? Activity : MessageSquare;

  return (
    <SessionBadgeShell
      label={label}
      className={cn(
        kind === "execution"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-sky-200 bg-sky-50 text-sky-700",
        className,
      )}
      icon={<Icon className="h-3 w-3" aria-hidden="true" />}
    />
  );
}

export function SessionAgentBadge({ kind, className }: { kind: AgentKind; className?: string }) {
  const label = shortAgentKindLabel(kind);
  const Icon = AGENT_ICONS[kind];

  return (
    <SessionBadgeShell
      label={label}
      className={className}
      icon={<Icon className="h-3 w-3" />}
    />
  );
}

export function SessionStatusKindBadge({
  statusKind,
  label,
  className,
}: {
  statusKind: RecentStatusKind;
  label: string;
  className?: string;
}) {
  return <SessionBadgeShell label={label} className={cn(STATUS_CLASS[statusKind], className)} />;
}

export function recentSessionBadgeKind(session: RecentSession): SessionBadgeKind {
  return session.kind === "codex" ? "execution" : "chat";
}

export function recentSessionAgentKind(session: RecentSession): AgentKind | null {
  return session.agentKind ?? (session.kind === "codex" ? "codex" : null);
}

/**
 * Type + agent badges for a recent (chat or execution) session row. Shared by
 * the assistant screen and the project sessions screen so both render session
 * labels identically.
 */
export function RecentSessionBadges({ session, className }: { session: RecentSession; className?: string }) {
  const agentKind = recentSessionAgentKind(session);

  return (
    <>
      <SessionTypeBadge kind={recentSessionBadgeKind(session)} className={className} />
      {agentKind ? <SessionAgentBadge kind={agentKind} className={className} /> : null}
    </>
  );
}

export function SessionBadgeShell({
  label,
  icon,
  className,
}: {
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {icon ?? null}
      <span>{label}</span>
    </span>
  );
}
