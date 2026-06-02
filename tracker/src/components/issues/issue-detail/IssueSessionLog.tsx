import { useEffect, useRef, useState } from "react";

import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { sessionLogTopic } from "@/services/session-log";
import { payloadEntries, type SessionLogEntry } from "@/types/session-log";

interface IssueSessionLogProps {
  projectSlug: string;
  issueIdentifier: string;
  enabled: boolean;
}

export function IssueSessionLog({ projectSlug, issueIdentifier, enabled }: IssueSessionLogProps) {
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier.trim();
    if (!enabled || !project || !identifier) {
      setEntries([]);
      setConnected(false);
      return undefined;
    }

    const socket = createTrackerSocket();
    socket.connect();

    const channel = socket.channel(sessionLogTopic(project, identifier), { project_slug: project });
    let cancelled = false;

    channel.on("entries", (payload) => {
      const next = payloadEntries(payload);
      if (next.length === 0) return;
      setEntries((current) => [...current, ...next]);
    });

    channel
      .join()
      .receive("ok", (payload) => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
        setEntries(payloadEntries(payload));
      })
      .receive("error", (reason) => {
        if (cancelled) return;
        setConnected(false);
        setError(formatJoinError(reason));
      })
      .receive("timeout", () => {
        if (cancelled) return;
        setConnected(false);
        setError("Timed out joining session log channel");
      });

    return () => {
      cancelled = true;
      channel.leave();
      socket.disconnect();
    };
  }, [enabled, issueIdentifier, projectSlug]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [entries]);

  if (!enabled) {
    return null;
  }

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

function formatJoinError(reason: unknown): string {
  if (typeof reason === "object" && reason !== null) {
    const record = reason as Record<string, unknown>;
    if (typeof record.reason === "string") {
      return record.reason === "session_log_unavailable"
        ? "No Codex session log found for this issue yet."
        : record.reason;
    }
  }
  return "Failed to open session log stream";
}
