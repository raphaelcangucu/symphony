import { useEffect, useRef, useState } from "react";

import { createTrackerSocket } from "@/services/phoenix/socket";
import { sessionLogTopic } from "@/services/session-log";

interface IssueSessionLogProps {
  projectSlug: string;
  issueIdentifier: string;
  enabled: boolean;
}

export function IssueSessionLog({ projectSlug, issueIdentifier, enabled }: IssueSessionLogProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier.trim();
    if (!enabled || !project || !identifier) {
      setLines([]);
      setConnected(false);
      return undefined;
    }

    const socket = createTrackerSocket();
    socket.connect();

    const channel = socket.channel(sessionLogTopic(project, identifier), { project_slug: project });
    let cancelled = false;

    channel.on("lines", (payload) => {
      const next = payloadLines(payload);
      if (next.length === 0) return;
      setLines((current) => [...current, ...next]);
    });

    channel
      .join()
      .receive("ok", (payload) => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
        setLines(payloadLines(payload));
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
  }, [lines]);

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
        <pre
          ref={containerRef}
          aria-label={`Session log for ${issueIdentifier}`}
          className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100"
        >
          {lines.length > 0 ? lines.join("\n") : "Waiting for session output…"}
        </pre>
      )}
    </section>
  );
}

function payloadLines(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const lines = (payload as Record<string, unknown>).lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter((line): line is string => typeof line === "string" && line.trim() !== "");
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
