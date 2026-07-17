import { useEffect, useMemo, useState } from "react";

import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { i18n } from "@/i18n";
import { sessionLogAgentTopic } from "@/services/session-log";
import { payloadEntries, type SessionLogEntry } from "@/types/session-log";

export interface SubagentChannelMeta {
  nickname: string | null;
  role: string | null;
  label: string | null;
}

interface UseSubagentChannelArgs {
  projectSlug: string;
  parentSessionId: number | null;
  agentKind: string | null;
  subagentId: string | null;
  toolUseId?: string | null;
  enabled: boolean;
}

interface UseSubagentChannelResult {
  entries: SessionLogEntry[];
  connected: boolean;
  error: string | null;
  meta: SubagentChannelMeta;
}

const EMPTY_META: SubagentChannelMeta = {
  nickname: null,
  role: null,
  label: null,
};

export function useSubagentChannel({
  projectSlug,
  parentSessionId,
  agentKind,
  subagentId,
  toolUseId = null,
  enabled,
}: UseSubagentChannelArgs): UseSubagentChannelResult {
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SubagentChannelMeta>(EMPTY_META);

  const project = projectSlug.trim();
  const kind = agentKind?.trim() ?? "";
  const childId = subagentId?.trim() ?? "";
  const toolUse = typeof toolUseId === "string" ? toolUseId.trim() : "";

  const topic = useMemo(() => {
    if (!enabled || !project || parentSessionId == null || !kind || !childId) return null;
    try {
      return sessionLogAgentTopic(childId);
    } catch {
      return null;
    }
  }, [childId, enabled, kind, parentSessionId, project]);

  const active = topic != null;

  const { connected } = usePhoenixChannel({
    topic,
    params: {
      project_slug: project,
      agent_kind: kind,
      session_id: parentSessionId,
      ...(toolUse ? { tool_use_id: toolUse } : {}),
    },
    onSetup: (nextChannel) => {
      nextChannel.on("entries", (payload) => {
        const next = payloadEntries(payload);
        if (next.length === 0) return;
        setEntries((current) => [...current, ...next]);
      });
    },
    onJoin: (payload) => {
      setError(null);
      setEntries(payloadEntries(payload));
      setMeta(parseJoinMeta(payload));
    },
    onJoinError: (reason) => setError(formatJoinError(reason)),
    onJoinTimeout: () => setError(i18n.t("issue.toolCall.subagent.error")),
  });

  useEffect(() => {
    if (active) return;
    setEntries([]);
    setError(null);
    setMeta(EMPTY_META);
  }, [active]);

  return {
    entries,
    connected,
    error,
    meta,
  };
}

function parseJoinMeta(payload: unknown): SubagentChannelMeta {
  if (!payload || typeof payload !== "object") return EMPTY_META;
  const record = payload as Record<string, unknown>;
  const metaRecord =
    record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
      ? (record.meta as Record<string, unknown>)
      : record;

  return {
    nickname: stringOrNull(metaRecord.nickname),
    role: stringOrNull(metaRecord.role),
    label: stringOrNull(metaRecord.label),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatJoinError(reason: unknown): string {
  if (typeof reason === "object" && reason !== null) {
    const record = reason as Record<string, unknown>;
    if (typeof record.reason === "string" && record.reason.trim()) {
      return record.reason;
    }
  }
  return i18n.t("issue.toolCall.subagent.error");
}
