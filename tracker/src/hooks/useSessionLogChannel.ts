import type { Channel } from "phoenix";
import { useCallback, useEffect, useRef, useState } from "react";

import { createTrackerSocket } from "@/services/phoenix/socket";
import { sessionLogTopic } from "@/services/session-log";
import { payloadEntries, type SessionLogEntry } from "@/types/session-log";

interface UseSessionLogChannelArgs {
  projectSlug: string;
  issueIdentifier: string;
  enabled: boolean;
}

interface UseSessionLogChannelResult {
  channel: Channel | null;
  connected: boolean;
  entries: SessionLogEntry[];
  error: string | null;
  steerTurn: (message: string) => void;
  steerError: string | null;
  steerPending: boolean;
}

export function useSessionLogChannel({
  projectSlug,
  issueIdentifier,
  enabled,
}: UseSessionLogChannelArgs): UseSessionLogChannelResult {
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const [steerPending, setSteerPending] = useState(false);
  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier.trim();
    if (!enabled || !project || !identifier) {
      setEntries([]);
      setConnected(false);
      setError(null);
      setSteerError(null);
      setSteerPending(false);
      channelRef.current = null;
      return undefined;
    }

    const socket = createTrackerSocket();
    socket.connect();

    const channel = socket.channel(sessionLogTopic(project, identifier), { project_slug: project });
    channelRef.current = channel;
    let cancelled = false;

    channel.on("entries", (payload) => {
      const next = payloadEntries(payload);
      if (next.length === 0) return;
      setEntries((current) => [...current, ...next]);
    });

    channel.on("steer_ok", () => {
      if (cancelled) return;
      setSteerPending(false);
      setSteerError(null);
    });

    channel.on("steer_failed", (payload) => {
      if (cancelled) return;
      setSteerPending(false);
      const record = payload as Record<string, unknown>;
      const reason = typeof record.reason === "string" ? record.reason : "steer_failed";
      setSteerError(reason);
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
      channelRef.current = null;
      channel.leave();
      socket.disconnect();
    };
  }, [enabled, issueIdentifier, projectSlug]);

  const steerTurn = useCallback((message: string) => {
    const channel = channelRef.current;
    const trimmed = message.trim();
    if (!channel || !trimmed) return;

    setSteerPending(true);
    setSteerError(null);
    channel.push("steer_turn", { message: trimmed }).receive("error", (reason) => {
      setSteerPending(false);
      const record = reason as Record<string, unknown>;
      const replyReason = typeof record.reason === "string" ? record.reason : "steer_failed";
      setSteerError(replyReason);
    });
  }, []);

  return {
    channel: channelRef.current,
    connected,
    entries,
    error,
    steerTurn,
    steerError,
    steerPending,
  };
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
