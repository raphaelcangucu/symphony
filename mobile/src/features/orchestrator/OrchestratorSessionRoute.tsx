import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StateView } from "@/components/StateView";
import { AssistantChatScreen } from "@/features/sessions/AssistantChatScreen";
import { hostTerminalRoute } from "@/features/sessions/session-navigation";
import type { SessionTimelineState } from "@/features/sessions/session-reducer";
import { useAppRuntime } from "@/runtime/AppRuntime";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";

import {
  appendSessionLogEntries,
  buildOrchestratorTimeline,
  type SessionLogEntry,
} from "./orchestrator-session-adapter";
import { createRpcOrchestratorSession } from "./rpc-orchestrator-session";

export function OrchestratorSessionRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    agent?: string | string[];
    executionSessionId?: string | string[];
    hostId?: string | string[];
    identifier?: string | string[];
    status?: string | string[];
  }>();
  const { dictate } = useAppRuntime();
  const hostRuntime = useHostRuntime();
  const hostId = firstParam(params.hostId);
  const executionSessionId = positiveInteger(firstParam(params.executionSessionId));
  const identifier = firstParam(params.identifier);
  const agent = firstParam(params.agent);
  const transport = hostId ? hostRuntime.transport(hostId) : null;
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [connectionState, setConnectionState] =
    useState<SessionTimelineState["connectionState"]>("connecting");
  const [error, setError] = useState<string | null>(null);
  const onSnapshot = useCallback((next: SessionLogEntry[]) => setEntries(next), []);
  const onEntries = useCallback(
    (next: SessionLogEntry[]) =>
      setEntries((current) => appendSessionLogEntries(current, { entries: next })),
    [],
  );

  const session = useMemo(
    () =>
      transport && executionSessionId
        ? createRpcOrchestratorSession({
            executionSessionId,
            transport,
            onSnapshot,
            onEntries,
            onConnection: setConnectionState,
            onError: setError,
          })
        : null,
    [executionSessionId, onEntries, onSnapshot, transport],
  );

  useEffect(() => {
    session?.connect();
    return () => session?.disconnect();
  }, [session]);

  if (!hostId || !executionSessionId) {
    return (
      <StateView
        actionLabel="Back"
        kind="error"
        onAction={() => router.back()}
        title="Invalid orchestrator session"
      />
    );
  }
  if (!transport || !session) {
    return <StateView kind="loading" title="Connecting to Symphony host" />;
  }

  const title = [identifier || `Run ${executionSessionId}`, agentLabel(agent)]
    .filter(Boolean)
    .join(" · ");
  const timeline = buildOrchestratorTimeline(entries, connectionState, error);

  return (
    <AssistantChatScreen
      onApproval={async () => undefined}
      onBack={() => router.back()}
      onDictate={() => dictate(resolvedLocale())}
      onOpenTerminal={() =>
        router.push(
          hostTerminalRoute(
            hostId,
            executionSessionId,
            identifier ?? `Run ${executionSessionId}`,
          ) as never,
        )
      }
      onResumeTurn={async () => undefined}
      onSend={(message) => session.steer(message)}
      onStopTurn={async () => undefined}
      onSubmitUserInput={async () => undefined}
      threadId={executionSessionId}
      timeline={timeline}
      title={title}
    />
  );
}

function positiveInteger(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function agentLabel(agent: string | null): string | null {
  if (agent === "codex") return "Codex";
  if (agent === "claude") return "Claude";
  if (agent === "cursor") return "Cursor";
  if (agent === "opencode") return "OpenCode";
  return null;
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
