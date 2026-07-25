import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import type { TerminalConnectionState } from "@/realtime/terminal-session";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { TerminalScreen } from "./TerminalScreen";

export function TerminalRoute() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile, activeToken } = useConnection();
  const { createTerminalSession } = useAppRuntime();
  const threadId = parseThreadId(firstParam(params.threadId));
  const threadQuery = useQuery({
    queryKey: ["terminal-thread", activeProfile?.id, threadId],
    enabled: Boolean(client && threadId),
    queryFn: async ({ signal }) => {
      const threads = await client!.threads({ limit: 100, includeArchived: true }, signal);
      return threads.find((thread) => thread.id === threadId) ?? null;
    },
  });
  const [output, setOutput] = useState("");
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const session = useMemo(() => {
    const projectSlug = threadQuery.data?.projectSlug;
    if (!threadId || !projectSlug || !activeProfile || !activeToken) return null;
    return createTerminalSession({
      threadId,
      projectSlug,
      origin: activeProfile.origin,
      token: activeToken,
      onOutput: setOutput,
      onState: setConnectionState,
      onError: setError,
    });
  }, [
    activeProfile,
    activeToken,
    createTerminalSession,
    generation,
    threadId,
    threadQuery.data?.projectSlug,
  ]);
  useEffect(() => {
    session?.connect();
    return () => session?.disconnect();
  }, [session]);

  if (!threadId) return null;
  return (
    <TerminalScreen
      connectionState={connectionState}
      error={
        error ??
        (threadQuery.isError
          ? threadQuery.error instanceof Error
            ? threadQuery.error.message
            : "Could not load workspace"
          : threadQuery.data === null
            ? "Session workspace is unavailable"
            : null)
      }
      onBack={() => router.back()}
      onInput={(data) => session?.sendInput(data)}
      onReconnect={() => {
        setError(null);
        setGeneration((value) => value + 1);
      }}
      output={output}
      threadId={threadId}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function parseThreadId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
