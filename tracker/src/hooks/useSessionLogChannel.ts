import type { Channel } from "phoenix";
import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { sessionLogTopic } from "@/services/session-log";
import { payloadEntries, type SessionLogEntry } from "@/types/session-log";

interface UseSessionLogChannelArgs {
  projectSlug: string;
  issueIdentifier: string;
  enabled: boolean;
  agentKind?: string | null;
}

interface UseSessionLogChannelResult {
  channel: Channel | null;
  connected: boolean;
  entries: SessionLogEntry[];
  error: string | null;
  logAgentKind: string | null;
  preferredAgentKind: string | null;
  logFallback: boolean;
  steerTurn: (message: string) => void;
  steerError: string | null;
  steerPending: boolean;
}

const AGENT_LOG_LABEL_KEYS: Record<string, string> = {
  codex: "issue.sessionLog.agentLabels.codex",
  claude: "issue.sessionLog.agentLabels.claude",
  cursor: "issue.sessionLog.agentLabels.cursor",
};

export function useSessionLogChannel({
  projectSlug,
  issueIdentifier,
  enabled,
  agentKind,
}: UseSessionLogChannelArgs): UseSessionLogChannelResult {
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const [steerPending, setSteerPending] = useState(false);
  const [logAgentKind, setLogAgentKind] = useState<string | null>(null);
  const [preferredAgentKind, setPreferredAgentKind] = useState<string | null>(null);
  const [logFallback, setLogFallback] = useState(false);
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
      setLogAgentKind(null);
      setPreferredAgentKind(null);
      setLogFallback(false);
      channelRef.current = null;
      return undefined;
    }

    const socket = createTrackerSocket();
    socket.connect();

    const joinParams: Record<string, string> = { project_slug: project };
    const preferredKind = agentKind?.trim();
    if (preferredKind) joinParams.agent_kind = preferredKind;
    const channel = socket.channel(sessionLogTopic(project, identifier), joinParams);
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
        const record = payload as Record<string, unknown>;
        setLogAgentKind(typeof record.agent_kind === "string" ? record.agent_kind : null);
        setPreferredAgentKind(
          typeof record.preferred_agent_kind === "string" ? record.preferred_agent_kind : null,
        );
        setLogFallback(record.log_fallback === true);
      })
      .receive("error", (reason) => {
        if (cancelled) return;
        setConnected(false);
        setError(formatJoinError(reason, agentKind));
      })
      .receive("timeout", () => {
        if (cancelled) return;
        setConnected(false);
        setError(i18n.t("issue.sessionLog.errors.joinTimeout"));
      });

    return () => {
      cancelled = true;
      channelRef.current = null;
      channel.leave();
      socket.disconnect();
    };
  }, [agentKind, enabled, issueIdentifier, projectSlug]);

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
    logAgentKind,
    preferredAgentKind,
    logFallback,
    steerTurn,
    steerError,
    steerPending,
  };
}

function formatJoinError(reason: unknown, agentKind?: string | null): string {
  if (typeof reason === "object" && reason !== null) {
    const record = reason as Record<string, unknown>;
    if (typeof record.reason === "string") {
      if (record.reason === "session_log_unavailable") {
        const labelKey = agentKind ? AGENT_LOG_LABEL_KEYS[agentKind] : null;
        const label = labelKey ? i18n.t(labelKey) : agentKind;
        return label
          ? i18n.t("issue.sessionLog.errors.noLogForAgent", { agent: label })
          : i18n.t("issue.sessionLog.errors.noLog");
      }
      return record.reason;
    }
  }
  return i18n.t("issue.sessionLog.errors.streamFailed");
}
