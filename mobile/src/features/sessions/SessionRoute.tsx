import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useReducer } from "react";

import { useHostTransport } from "@/api/HostTransportContext";
import { useConnection } from "@/auth/ConnectionProvider";
import type { ConnectionProfile } from "@/auth/connection-profile";
import { StateView } from "@/components/StateView";
import { createRpcAssistantSession } from "@/realtime/rpc-assistant-session";
import { useAppRuntime } from "@/runtime/AppRuntime";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import type { HostTransport } from "@/transport/HostTransport";

import { createSessionTimelineState, sessionTimelineReducer } from "./session-reducer";
import { AssistantChatScreen } from "./AssistantChatScreen";
import { hostChatRoute, hostTerminalRoute } from "./session-navigation";

export function SessionRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    name?: string | string[];
    threadId?: string | string[];
    seed?: string | string[];
  }>();
  const { activeProfile, activeToken } = useConnection();
  const threadId = parseThreadId(firstParam(params.threadId));
  const seed = firstParam(params.seed);
  const title = firstParam(params.name);

  if (!threadId) {
    return (
      <StateView
        actionLabel="Back"
        kind="error"
        onAction={() => router.back()}
        title="Invalid session"
      />
    );
  }
  if (!activeProfile) return null;

  return (
    <ConnectedSessionRoute
      key={`${activeProfile.hostId ?? activeProfile.id}:${threadId}`}
      activeProfile={activeProfile}
      activeToken={activeToken}
      router={router}
      seed={seed}
      title={title}
      threadId={threadId}
    />
  );
}

export function HostSessionRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    hostId?: string | string[];
    name?: string | string[];
    threadId?: string | string[];
    seed?: string | string[];
  }>();
  const { hydrated, profiles } = useConnection();
  const hostRuntime = useHostRuntime();
  const hostId = firstParam(params.hostId);
  const threadId = parseThreadId(firstParam(params.threadId));
  const title = firstParam(params.name);
  const seed = firstParam(params.seed);
  const profile =
    hostId === null
      ? null
      : (profiles.find(
          (candidate) =>
            candidate.transport === "rpc" &&
            (candidate.hostId === hostId || candidate.id === hostId),
        ) ?? null);
  const transport = hostId ? hostRuntime.transport(hostId) : null;

  if (!hydrated) return <StateView kind="loading" title="Loading Dev10x" />;
  if (!hostId || !threadId) {
    return (
      <StateView
        actionLabel="Back"
        kind="error"
        onAction={() => router.back()}
        title="Invalid session"
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
  if (!transport) {
    return (
      <StateView
        description="Restoring the direct encrypted connection to this Symphony host."
        kind="loading"
        title="Connecting to host"
      />
    );
  }

  return (
    <ConnectedSessionRoute
      key={`${hostId}:${threadId}`}
      activeProfile={profile}
      activeToken={null}
      hostId={hostId}
      hostTransport={transport}
      router={router}
      seed={seed}
      title={title}
      threadId={threadId}
    />
  );
}

function ConnectedSessionRoute({
  activeProfile,
  activeToken,
  hostId,
  hostTransport: hostTransportOverride,
  router,
  seed,
  title,
  threadId,
}: {
  activeProfile: ConnectionProfile;
  activeToken: string | null;
  hostId?: string;
  hostTransport?: HostTransport;
  router: ReturnType<typeof useRouter>;
  seed: string | null;
  title: string | null;
  threadId: number;
}) {
  const { createAssistantSession, dictate } = useAppRuntime();
  const activeHostTransport = useHostTransport();
  const hostTransport = hostTransportOverride ?? activeHostTransport;
  const [timeline, dispatch] = useReducer(
    sessionTimelineReducer,
    undefined,
    createSessionTimelineState,
  );
  const session = useMemo(() => {
    const onSeedAccepted = () => {
      void AsyncStorage.removeItem(
        `symphony.new-session.draft.${activeProfile.hostId ?? activeProfile.id}`,
      )
        .catch(() => undefined)
        .then(() =>
          router.replace(
            (hostId
              ? hostChatRoute(hostId, threadId, title ?? undefined)
              : `/session/${threadId}`) as never,
          ),
        );
    };
    if (activeProfile.transport === "rpc") {
      if (!hostTransport) return null;
      return createRpcAssistantSession({
        threadId,
        transport: hostTransport,
        seed,
        onAction: dispatch,
        onSeedAccepted,
      });
    }
    if (!activeToken) return null;
    return createAssistantSession({
      threadId,
      origin: activeProfile.origin,
      token: activeToken,
      locale: resolvedLocale(),
      seed,
      onAction: dispatch,
      onSeedAccepted,
    });
  }, [activeProfile, activeToken, createAssistantSession, hostTransport, router, seed, threadId]);

  useEffect(() => {
    session?.connect();
    return () => session?.disconnect();
  }, [session]);

  if (!session) return null;

  return (
    <AssistantChatScreen
      onApproval={(requestId, action) => session.submitApproval(requestId, action)}
      onBack={() => router.back()}
      onDictate={() => dictate(resolvedLocale())}
      onOpenTerminal={() =>
        router.push(
          (hostId
            ? hostTerminalRoute(hostId, threadId, title ?? undefined)
            : `/session/${threadId}/terminal`) as never,
        )
      }
      onResumeTurn={() => session.resumeTurn()}
      onRetrySeed={seed ? () => session.retrySeed() : undefined}
      onSend={(message) => session.sendMessage(message)}
      onStopTurn={() => session.stopTurn()}
      onSubmitUserInput={(requestId, answers) => session.submitUserInput(requestId, answers)}
      title={title ?? `Session ${threadId}`}
      threadId={threadId}
      timeline={timeline}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseThreadId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
