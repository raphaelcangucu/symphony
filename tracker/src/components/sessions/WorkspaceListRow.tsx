import {
  AlertTriangle,
  GitBranch,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ChatStatusIcon } from "@/components/shared/ChatStatusIcon";
import { StatusPill } from "@/components/ui/status-pill";
import { executionStatusDotClass } from "@/lib/statusPresentation";
import { formatBytes, type WorkspaceCard, type WorkspaceListItem } from "@/lib/workspaceCards";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { RecentSession } from "@/types/recents";

interface WorkspaceListRowProps {
  item: WorkspaceListItem;
  selected: boolean;
  onSelect(): void;
  onOpenChat?(session: RecentSession): void;
}

export function WorkspaceListRow({
  item,
  selected,
  onSelect,
  onOpenChat,
}: WorkspaceListRowProps) {
  const { t } = useTranslation();

  if (item.kind === "chat") {
    const { session } = item;
    const openable = session.threadId != null && onOpenChat;
    return (
      <button
        type="button"
        onClick={() => {
          if (openable) {
            onOpenChat(session);
            return;
          }
          onSelect();
        }}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none",
          "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
          selected && "bg-black/[0.06] dark:bg-white/[0.08]",
        )}
      >
        <ChatStatusIcon statusKind={session.statusKind} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{t("workspacesPage.sections.chats")}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </button>
    );
  }

  const { card } = item;
  const title =
    card.kind === "project"
      ? t("workspacesPage.projectWorkspace")
      : card.title || card.issueIdentifier || card.key;
  const branch = primaryBranch(card);
  const size = card.inventory ? formatBytes(card.inventory.sizeBytes) : null;
  const dirty = Boolean(card.inventory?.workPresent);
  const orphan = card.inventory?.classification === "orphan" || card.kind === "orphan";
  const sessionLabel = activityLabel(card, t);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none",
        "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        selected && "bg-black/[0.06] dark:bg-white/[0.08]",
      )}
    >
      {card.execution ? (
        <ExecutionDot status={card.execution.status} />
      ) : (
        <StatusDot tone={orphan ? "waiting" : "idle"} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {card.issueIdentifier ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {card.issueIdentifier}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {orphan ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={2} aria-hidden />
          ) : null}
          {dirty ? (
            <StatusPill tone="warning" size="sm" className="shrink-0">
              {t("workspacesPage.dirtyBadge", { defaultValue: "dirty" })}
            </StatusPill>
          ) : null}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {branch ? (
            <>
              <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
              <span className="truncate font-mono">{branch}</span>
            </>
          ) : null}
          {size ? (
            <>
              {branch ? <span className="text-muted-foreground/40">·</span> : null}
              <span className="shrink-0">{size}</span>
            </>
          ) : null}
          {sessionLabel ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate">{sessionLabel}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {relativeActivity(card)}
      </span>
    </button>
  );
}

function primaryBranch(card: WorkspaceCard): string | null {
  const repos = card.inventory?.repos ?? [];
  if (repos.length === 0) return null;
  return repos[0]?.branch ?? null;
}

function activityLabel(
  card: WorkspaceCard,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (card.execution) {
    return `${t("workspacesPage.sessionRows.execution")} · ${t("sessions.turns", {
      count: card.execution.turnCount,
    })}`;
  }
  if (card.authoring) return t("workspacesPage.sessionRows.authoring");
  if (card.sessions[0]) return card.sessions[0].title;
  return null;
}

function relativeActivity(card: WorkspaceCard) {
  const stamp =
    card.execution?.lastEventAt ??
    card.execution?.startedAt ??
    card.authoring?.updatedAt ??
    card.sessions[0]?.updatedAt ??
    null;
  return stamp ? formatRelativeTime(stamp) : "";
}

function StatusDot({ tone }: { tone: "active" | "waiting" | "idle" | "error" }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        tone === "active" && "bg-emerald-500",
        tone === "waiting" && "bg-amber-500",
        tone === "idle" && "bg-muted-foreground/40",
        tone === "error" && "bg-destructive",
      )}
      aria-hidden
    />
  );
}

function ExecutionDot({ status }: { status: AgentExecutionStatus }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", executionStatusDotClass(status))}
      aria-hidden
    />
  );
}
