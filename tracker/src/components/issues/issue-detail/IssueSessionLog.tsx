import { useEffect, useRef } from "react";

import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
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

const LOG_AGENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor Agent",
};

export function IssueSessionLog({
  issueIdentifier,
  connected,
  entries,
  error,
  logAgentKind = null,
  preferredAgentKind = null,
}: IssueSessionLogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const items = pairSessionLogItems(entries);

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
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session log</div>
        <span className="text-[11px] text-muted-foreground">{connected ? "Streaming" : "Connecting…"}</span>
      </div>
      {logAgentKind && preferredAgentKind && logAgentKind !== preferredAgentKind ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {LOG_AGENT_LABELS[logAgentKind] ?? logAgentKind} history —{" "}
          {LOG_AGENT_LABELS[preferredAgentKind] ?? preferredAgentKind} has not produced a log for this issue yet.
        </p>
      ) : logAgentKind ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Source: {LOG_AGENT_LABELS[logAgentKind] ?? logAgentKind}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : (
        <div
          ref={containerRef}
          aria-label={`Session log for ${issueIdentifier}`}
          className={cn("mt-3 max-h-[520px] space-y-3 overflow-auto rounded-lg bg-muted/20 p-3", SCROLLBAR_THIN)}
        >
          {items.length > 0 ? (
            items.map((item, index) =>
              item.type === "toolCall" ? (
                <ToolCallBlock view={sessionPairToView(item.call, item.result)} key={`tool-${item.call.callId}-${index}`} />
              ) : (
                <SessionLogEntryCard entry={item.entry} key={`${item.entry.kind}-${item.entry.title}-${index}`} />
              ),
            )
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Waiting for session output…</p>
          )}
        </div>
      )}
    </section>
  );
}
