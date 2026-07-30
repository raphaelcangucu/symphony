import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";

import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import { useConnection } from "@/auth/ConnectionProvider";
import { StateView } from "@/components/StateView";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";

import { DiffRoute } from "./DiffRoute";

/**
 * A provider-neutral Changes route scoped to the selected Symphony machine.
 * It deliberately uses that host's direct RPC transport instead of the global
 * profile, which may point at a different paired machine.
 */
export function HostDiffRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    hostId?: string | string[];
    threadId?: string | string[];
  }>();
  const { hydrated, profiles } = useConnection();
  const hostRuntime = useHostRuntime();
  const hostId = firstParam(params.hostId);
  const threadId = parseThreadId(firstParam(params.threadId));
  const profile = hostId
    ? (profiles.find(
        (candidate) =>
          candidate.transport === "rpc" &&
          (candidate.hostId === hostId || candidate.id === hostId),
      ) ?? null)
    : null;
  const transport = hostId ? hostRuntime.transport(hostId) : null;
  const client = useMemo(
    () => (transport ? createRpcTrackerClient(transport) : null),
    [transport],
  );

  if (!hydrated) return <StateView kind="loading" title="Loading Dev10x" />;
  if (!hostId || !threadId) {
    return (
      <StateView
        actionLabel="Back"
        kind="error"
        onAction={() => router.back()}
        title="Invalid Changes route"
      />
    );
  }
  if (!profile) {
    return (
      <StateView
        actionLabel="Back"
        description="Pair this Symphony host again to restore its encrypted device credential."
        kind="error"
        onAction={() => router.back()}
        title="Host is not paired"
      />
    );
  }
  if (!client) {
    return (
      <StateView
        description="Restoring the direct encrypted connection to this Symphony host."
        kind="loading"
        title="Connecting to host"
      />
    );
  }

  return <DiffRoute client={client} hostId={hostId} threadId={threadId} />;
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function parseThreadId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
