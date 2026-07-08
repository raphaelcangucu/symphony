import { Activity, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { AGENT_ICONS } from "@/components/shared/AgentChip";
import { recentStatusBadgeClass } from "@/lib/statusPresentation";
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
          ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
          : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
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
  return <SessionBadgeShell label={label} className={cn(recentStatusBadgeClass(statusKind), className)} />;
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
