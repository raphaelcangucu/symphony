import { Activity, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { AGENT_ICONS } from "@/components/shared/AgentChip";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

export type SessionBadgeKind = "chat" | "execution";

const AGENT_LABELS: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
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

function SessionBadgeShell({
  label,
  icon,
  className,
}: {
  label: string;
  icon: ReactNode;
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
      {icon}
      <span>{label}</span>
    </span>
  );
}
