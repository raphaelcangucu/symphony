import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { AgentTaskInlineCard } from "@/components/issues/issue-detail/AgentTaskInlineCard";
import { AgentTaskList } from "@/components/issues/issue-detail/AgentTaskList";
import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { deriveAgentTasks, isAgentTaskTool } from "@/lib/agentTasks";
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
}: IssueSessionLogProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const items = pairSessionLogItems(entries);
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
    <section className="rounded-xl border p-4">
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
      {taskSnapshot ? <AgentTaskList snapshot={taskSnapshot} /> : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : (
        <div
          ref={containerRef}
          aria-label={t("issue.sessionLog.ariaLabel", { identifier: issueIdentifier })}
          className={cn("mt-3 max-h-[520px] space-y-3 overflow-auto rounded-lg bg-muted/20 p-3", SCROLLBAR_THIN)}
        >
          {items.length > 0 ? (
            items.map((item, index) =>
              item.type === "toolCall" ? (
                isAgentTaskTool(item.call.title) && taskSnapshot ? (
                  <AgentTaskInlineCard snapshot={taskSnapshot} key={`task-${item.call.callId}-${index}`} />
                ) : (
                  <ToolCallBlock
                    view={sessionPairToView(item.call, item.result)}
                    key={`tool-${item.call.callId}-${index}`}
                  />
                )
              ) : (
                <SessionLogEntryCard entry={item.entry} key={`${item.entry.kind}-${item.entry.title}-${index}`} />
              ),
            )
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("issue.sessionLog.waiting")}</p>
          )}
        </div>
      )}
    </section>
  );
}
