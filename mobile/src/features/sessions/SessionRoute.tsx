import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import { useHostTransport } from "@/api/HostTransportContext";
import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import { useConnection } from "@/auth/ConnectionProvider";
import type { ConnectionProfile } from "@/auth/connection-profile";
import { StateView } from "@/components/StateView";
import { createRpcAssistantSession } from "@/realtime/rpc-assistant-session";
import { useAppRuntime } from "@/runtime/AppRuntime";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import type { HostTransport } from "@/transport/HostTransport";
import type { EvidenceArtifact, EvidenceRecord } from "@/features/evidence/evidence-contract";
import { useTaskEvidence } from "@/features/evidence/useTaskEvidence";
import { useThreadSourceChanges } from "@/features/source-control/use-thread-source-changes";

import { createSessionTimelineState, sessionTimelineReducer } from "./session-reducer";
import { AssistantChatScreen } from "./AssistantChatScreen";
import {
  assistantThreadDiffRoute,
  hostChatRoute,
  hostTerminalRoute,
} from "./session-navigation";

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
  const { createAssistantSession, dictate, startDictation } = useAppRuntime();
  const hostRuntime = useHostRuntime();
  const activeHostTransport = useHostTransport();
  const hostTransport = hostTransportOverride ?? activeHostTransport;
  const scopedTrackerClient = useMemo(
    () =>
      activeProfile.transport === "rpc" && hostTransport
        ? createRpcTrackerClient(hostTransport)
        : null,
    [activeProfile.transport, hostTransport],
  );
  const [timeline, dispatch] = useReducer(
    sessionTimelineReducer,
    undefined,
    createSessionTimelineState,
  );
  const catalogHostId = activeProfile.transport === "rpc" ? activeProfile.hostId : null;
  const sourceChanges = useThreadSourceChanges(threadId, {
    client: scopedTrackerClient,
    hostId: hostId ?? activeProfile.hostId ?? activeProfile.id,
  });
  const changesRoute = assistantThreadDiffRoute(threadId, hostId);
  const catalogState = catalogHostId
    ? hostRuntime.assistantCatalog(catalogHostId)
    : { catalog: null, error: null, status: "unavailable" as const };
  const projectSlug = timeline.metadata.projectSlug;
  const issueIdentifier = timeline.metadata.issueIdentifier;
  const taskHostId =
    activeProfile.transport === "rpc"
      ? hostId ?? activeProfile.hostId ?? activeProfile.id
      : null;
  const taskEvidence = useTaskEvidence({
    transport: hostTransport ?? null,
    projectSlug: projectSlug ?? "",
    identifier: issueIdentifier ?? "",
  });
  const taskRoute = useCallback(() => {
    if (!projectSlug || !issueIdentifier) return null;
    // A session may be restored through /session/:id, which has no hostId in
    // the URL. Route task reads through the same paired Host RPC connection
    // rather than falling back to an offline REST tracker client.
    const prefix = taskHostId ? `/h/${encodeURIComponent(taskHostId)}` : "";
    return `${prefix}/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(issueIdentifier)}`;
  }, [issueIdentifier, projectSlug, taskHostId]);
  const openEvidenceLink = useCallback(
    (href: string): boolean => {
      const taskPath = taskRoute();
      if (!taskPath) return false;
      const match = findEvidenceArtifact(taskEvidence.records, href);
      if (match) {
        router.push(
          `${taskPath}/evidence/${encodeURIComponent(match.record.runId)}?artifactPath=${encodeURIComponent(match.artifact.path)}` as never,
        );
      } else {
        router.push(`${taskPath}/evidence` as never);
      }
      return true;
    },
    [router, taskEvidence.records, taskRoute],
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

  useEffect(() => {
    if (catalogHostId) hostRuntime.prefetchAssistantCatalog(catalogHostId);
  }, [catalogHostId, hostRuntime]);

  if (!session) return null;

  return (
    <AssistantChatScreen
      catalog={catalogState.catalog}
      catalogStatus={catalogState.status}
      onApproval={(requestId, action) => session.submitApproval(requestId, action)}
      onBack={() => router.back()}
      onDictate={() => dictate(resolvedLocale())}
      onStartDictation={startDictation ? () => startDictation(resolvedLocale()) : undefined}
      onOpenTerminal={() =>
        router.push(
          (hostId
            ? hostTerminalRoute(hostId, threadId, title ?? undefined)
            : `/session/${threadId}/terminal`) as never,
        )
      }
      onOpenChanges={() => changesRoute && router.push(changesRoute as never)}
      onOpenEvidenceLink={openEvidenceLink}
      onClearGoal={() => session.clearGoal()}
      onKillTool={(toolCallId) => session.killTool(toolCallId)}
      onPauseGoal={() => session.pauseGoal()}
      onResumeTurn={() => session.resumeTurn()}
      onResumeGoal={() => session.resumeGoal()}
      onRetrySeed={seed ? () => session.retrySeed() : undefined}
      onSend={(message, contextRefs) => session.sendMessage(message, contextRefs)}
      onSetGoalMode={(enabled, objective) => session.setGoalMode(enabled, objective)}
      onSetGoalObjective={(objective) => session.setGoalObjective(objective)}
      onSetTurnPreferences={(preferences) => session.setTurnPreferences(preferences)}
      onStopTurn={() => session.stopTurn()}
      onSubmitUserInput={(requestId, answers) => session.submitUserInput(requestId, answers)}
      title={title ?? `Session ${threadId}`}
      threadId={threadId}
      sourceChanges={sourceChanges}
      taskLinks={
        projectSlug && issueIdentifier
          ? {
              identifier: issueIdentifier,
              onOpenEvidence: () => openEvidenceLink(""),
              onOpenPullRequest: () => {
                const route = taskRoute();
                if (route) router.push(`${route}/pull-request` as never);
              },
              onOpenTask: () => {
                const route = taskRoute();
                if (route) router.push(route as never);
              },
            }
          : undefined
      }
      timeline={timeline}
    />
  );
}

function findEvidenceArtifact(
  records: EvidenceRecord[],
  href: string,
): { artifact: EvidenceArtifact; record: EvidenceRecord } | null {
  const normalizedHref = normalizeEvidenceHref(href);
  const hrefName = pathBasename(normalizedHref);
  for (const record of records) {
    for (const run of record.manifest.runs) {
      for (const artifact of run.artifacts) {
        const artifactPath = normalizeEvidenceHref(artifact.path);
        if (artifactPath === normalizedHref || pathBasename(artifactPath) === hrefName) {
          return { artifact, record };
        }
      }
    }
  }
  return null;
}

function normalizeEvidenceHref(value: string): string {
  try {
    return decodeURIComponent(value).replace(/^file:\/\//, "").replace(/\\/g, "/");
  } catch {
    return value.replace(/^file:\/\//, "").replace(/\\/g, "/");
  }
}

function pathBasename(value: string): string {
  return value.split("/").filter(Boolean).at(-1) ?? value;
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
