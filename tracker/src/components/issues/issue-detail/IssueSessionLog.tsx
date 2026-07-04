import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  AgentTaskPinnedPanel,
  SessionLogTranscript,
} from "@/components/agent-activity";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { deriveAgentTasks } from "@/lib/agentTasks";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { SessionLogEntry } from "@/types/session-log";

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

interface IssueSessionLogProps {
  issueIdentifier: string;
  connected: boolean;
  entries: SessionLogEntry[];
  error: string | null;
  logAgentKind?: string | null;
  preferredAgentKind?: string | null;
  /** Grow to fill the available height (chat layout) instead of a fixed max. */
  fill?: boolean;
}

function resolveAgentLabel(kind: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (kind === "codex" || kind === "claude" || kind === "cursor") return agentKindLabel(kind, t);
  return kind;
}

export function IssueSessionLog({
  issueIdentifier,
  connected,
  entries,
  error,
  logAgentKind = null,
  preferredAgentKind = null,
  fill = false,
}: IssueSessionLogProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const taskSnapshot = deriveAgentTasks(entries);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateStickiness = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };

    updateStickiness();
    container.addEventListener("scroll", updateStickiness, { passive: true });
    return () => container.removeEventListener("scroll", updateStickiness);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [entries]);

  return (
    <section className={cn("rounded-xl border p-4", fill && "flex min-h-0 flex-1 flex-col")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("issue.sessionLog.title")}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {connected ? t("issue.sessionLog.streaming") : t("issue.sessionLog.connecting")}
        </span>
      </div>
      {logAgentKind && preferredAgentKind && logAgentKind !== preferredAgentKind ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("issue.sessionLog.agentHistory", {
            shown: resolveAgentLabel(logAgentKind, t),
            preferred: resolveAgentLabel(preferredAgentKind, t),
          })}
        </p>
      ) : logAgentKind ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("issue.sessionLog.source", { agent: resolveAgentLabel(logAgentKind, t) })}
        </p>
      ) : null}
      <AgentTaskPinnedPanel snapshot={taskSnapshot} />
      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : (
        <div
          ref={containerRef}
          aria-label={t("issue.sessionLog.ariaLabel", { identifier: issueIdentifier })}
          className={cn(
            "mt-3 space-y-3 overflow-auto rounded-lg bg-muted/20 p-3",
            SCROLLBAR_THIN,
            fill ? "min-h-0 flex-1" : "max-h-[520px]",
          )}
        >
          {entries.length > 0 ? (
            <SessionLogTranscript entries={entries} taskSnapshot={taskSnapshot} />
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("issue.sessionLog.waiting")}</p>
          )}
        </div>
      )}
    </section>
  );
}
