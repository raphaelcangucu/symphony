import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StateView } from "@/components/StateView";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";

import { orchestratorRunRoute, type OrchestratorExecution } from "./orchestrator-executions";
import { OrchestratorExecutionsScreen } from "./OrchestratorExecutionsScreen";
import { createRpcOrchestratorExecutions } from "./rpc-orchestrator-executions";

type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export function OrchestratorExecutionsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ hostId?: string | string[] }>();
  const hostId = firstParam(params.hostId);
  const hostRuntime = useHostRuntime();
  const transport = hostId ? hostRuntime.transport(hostId) : null;
  const [executions, setExecutions] = useState<OrchestratorExecution[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onSnapshot = useCallback((next: OrchestratorExecution[]) => setExecutions(next), []);

  const stream = useMemo(
    () =>
      transport
        ? createRpcOrchestratorExecutions({
            transport,
            onSnapshot,
            onConnection: setConnectionState,
            onError: setError,
          })
        : null,
    [attempt, onSnapshot, transport],
  );

  useEffect(() => {
    stream?.connect();
    return () => stream?.disconnect();
  }, [stream]);

  if (!hostId) {
    return (
      <StateView
        actionLabel="Back"
        kind="error"
        onAction={() => router.back()}
        title="Invalid host"
      />
    );
  }
  if (!transport) {
    return <StateView kind="loading" title="Connecting to Symphony host" />;
  }

  return (
    <OrchestratorExecutionsScreen
      connectionState={connectionState}
      error={error}
      executions={executions}
      onBack={() => router.back()}
      onOpen={(execution) =>
        router.push(
          orchestratorRunRoute(
            hostId,
            execution.executionSessionId,
            execution.issueIdentifier,
            execution.agentKind,
            execution.status,
          ) as never,
        )
      }
      onRetry={() => {
        transport.reconnect();
        setAttempt((current) => current + 1);
      }}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
