import { useEffect, useRef } from "react";

import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import type { SessionLogEntry } from "@/types/session-log";

interface IssueSessionLogProps {
  issueIdentifier: string;
  connected: boolean;
  entries: SessionLogEntry[];
  error: string | null;
}

export function IssueSessionLog({ issueIdentifier, connected, entries, error }: IssueSessionLogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [entries]);

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session log</div>
        <span className="text-[11px] text-muted-foreground">{connected ? "Streaming" : "Connecting…"}</span>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : (
        <div
          ref={containerRef}
          aria-label={`Session log for ${issueIdentifier}`}
          className="mt-3 max-h-[520px] space-y-3 overflow-auto rounded-lg bg-muted/20 p-3"
        >
          {entries.length > 0 ? (
            entries.map((entry, index) => <SessionLogEntryCard entry={entry} key={`${entry.kind}-${entry.title}-${index}`} />)
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Waiting for session output…</p>
          )}
        </div>
      )}
    </section>
  );
}
