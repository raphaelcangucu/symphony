import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useReducer } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { StateView } from "@/components/StateView";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { createSessionTimelineState, sessionTimelineReducer } from "./session-reducer";
import { SessionScreen } from "./SessionScreen";

export function SessionRoute() {
  const router = useRouter();
  const { createAssistantSession } = useAppRuntime();
  const params = useLocalSearchParams<{ threadId?: string | string[]; seed?: string | string[] }>();
  const { activeProfile, activeToken } = useConnection();
  const [timeline, dispatch] = useReducer(
    sessionTimelineReducer,
    undefined,
    createSessionTimelineState,
  );
  const threadId = parseThreadId(firstParam(params.threadId));
  const seed = firstParam(params.seed);
  const session = useMemo(() => {
    if (!threadId || !activeProfile || !activeToken) return null;
    return createAssistantSession({
      threadId,
      origin: activeProfile.origin,
      token: activeToken,
      locale: resolvedLocale(),
      seed,
      onAction: dispatch,
      onSeedAccepted: () => {
        void AsyncStorage.removeItem(`symphony.new-session.draft.${activeProfile.id}`)
          .catch(() => undefined)
          .then(() => router.replace(`/session/${threadId}`));
      },
    });
  }, [activeProfile, activeToken, router, seed, threadId]);

  useEffect(() => {
    session?.connect();
    return () => session?.disconnect();
  }, [session]);

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
  if (!session) return null;

  return (
    <SessionScreen
      onApproval={(requestId, action) => session.submitApproval(requestId, action)}
      onBack={() => router.back()}
      onResumeTurn={() => session.resumeTurn()}
      onRetrySeed={seed ? () => session.retrySeed() : undefined}
      onSend={(message) => session.sendMessage(message)}
      onStopTurn={() => session.stopTurn()}
      onSubmitUserInput={(requestId, answers) => session.submitUserInput(requestId, answers)}
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
