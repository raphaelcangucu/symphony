import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StateView } from "@/components/StateView";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { AssistantChatScreen } from "@/features/sessions/AssistantChatScreen";
import {
  assistantThreadDiffRoute,
  hostTerminalRoute,
} from "@/features/sessions/session-navigation";
import type { SessionTimelineState } from "@/features/sessions/session-reducer";
import { useAppRuntime } from "@/runtime/AppRuntime";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import { useThreadSourceChanges } from "@/features/source-control/use-thread-source-changes";

import {
  appendSessionLogEntries,
  buildOrchestratorTimeline,
  type SessionLogEntry,
} from "./orchestrator-session-adapter";
import { createRpcOrchestratorSession } from "./rpc-orchestrator-session";

type OrchestratorTaskContext = {
  projectSlug: string;
  identifier: string | null;
  agentKind: string | null;
};

export function OrchestratorSessionRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    agent?: string | string[];
    executionSessionId?: string | string[];
    hostId?: string | string[];
    identifier?: string | string[];
    project?: string | string[];
    projectSlug?: string | string[];
    status?: string | string[];
  }>();
  const { dictate, startDictation } = useAppRuntime();
  const hostRuntime = useHostRuntime();
  const trackerClient = useTrackerClient();
  const hostId = firstParam(params.hostId);
  const executionSessionId = positiveInteger(firstParam(params.executionSessionId));
  const identifier = firstParam(params.identifier);
  const project = firstParam(params.projectSlug) ?? firstParam(params.project);
  const agent = firstParam(params.agent);
  const transport = hostId ? hostRuntime.transport(hostId) : null;
  const sourceChanges = useThreadSourceChanges(executionSessionId);
  const changesRoute = assistantThreadDiffRoute(executionSessionId ?? "");
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [connectionState, setConnectionState] =
    useState<SessionTimelineState["connectionState"]>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [taskContext, setTaskContext] = useState<OrchestratorTaskContext | null>(null);
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

  useEffect(() => {
    if (!transport || !executionSessionId) return;
    let cancelled = false;
    void transport
      .call("orchestrator.session.context", {
        execution_session_id: executionSessionId,
      })
      .then((payload) => {
        const context = taskContextFromPayload(payload);
        if (!cancelled) setTaskContext(context);
      })
      .catch(() => {
        if (!cancelled) setTaskContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [executionSessionId, transport]);

  const taskProjectSlug = taskContext?.projectSlug ?? project;
  const taskIdentifier = taskContext?.identifier ?? identifier;
  const loadMagic = useCallback(
    () =>
      trackerClient && taskProjectSlug
        ? trackerClient.promptTemplates(taskProjectSlug)
        : Promise.resolve([]),
    [taskProjectSlug, trackerClient],
  );
  const searchContext = useCallback(
    async (query: string) => {
      if (!trackerClient || !taskProjectSlug) return [];
      const [issues, files, pullRequests] = await Promise.all([
        trackerClient.issues(taskProjectSlug, { query }).catch(() => []),
        taskIdentifier && query.trim()
          ? trackerClient.issueFiles(taskProjectSlug, taskIdentifier, query).catch(() => [])
          : Promise.resolve([]),
        taskIdentifier
          ? trackerClient
              .issuePullRequests(taskProjectSlug, taskIdentifier)
              .then((result) => result.pullRequests)
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      const normalizedQuery = query.trim().toLowerCase();
      return [
        ...issues.slice(0, 8).map((issue) => ({
          type: "issue" as const,
          id: issue.identifier,
          label: issue.title,
          detail: issue.status,
        })),
        ...files.slice(0, 8).map((path) => ({ type: "file" as const, id: path })),
        ...pullRequests
          .filter(
            (pullRequest) =>
              !normalizedQuery ||
              String(pullRequest.number).includes(normalizedQuery) ||
              (pullRequest.title ?? "").toLowerCase().includes(normalizedQuery),
          )
          .slice(0, 8)
          .map((pullRequest) => ({
            type: "pr" as const,
            id: String(pullRequest.number),
            label: pullRequest.title ?? undefined,
          })),
      ];
    },
    [taskIdentifier, taskProjectSlug, trackerClient],
  );

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
  const timeline = buildOrchestratorTimeline(
    entries,
    connectionState,
    error,
    taskContext?.agentKind ?? agent,
  );
  const taskLinks =
    taskProjectSlug && taskIdentifier
      ? {
          identifier: taskIdentifier,
          onOpenTask: () =>
            router.push(
              `/codex/issue/${encodeURIComponent(taskProjectSlug)}/${encodeURIComponent(taskIdentifier)}` as never,
            ),
          onOpenEvidence: () =>
            router.push(
              `/codex/issue/${encodeURIComponent(taskProjectSlug)}/${encodeURIComponent(taskIdentifier)}/evidence` as never,
            ),
          onOpenPullRequest: () =>
            router.push(
              `/codex/issue/${encodeURIComponent(taskProjectSlug)}/${encodeURIComponent(taskIdentifier)}/pull-request` as never,
            ),
        }
      : undefined;

  return (
    <AssistantChatScreen
      catalog={null}
      onApproval={async () => undefined}
      onBack={() => router.back()}
      onClearGoal={async () => undefined}
      onDictate={() => dictate(resolvedLocale())}
      onStartDictation={startDictation ? () => startDictation(resolvedLocale()) : undefined}
      onKillTool={async () => undefined}
      onOpenTerminal={() =>
        router.push(
          hostTerminalRoute(
            hostId,
            executionSessionId,
            identifier ?? `Run ${executionSessionId}`,
          ) as never,
        )
      }
      onOpenChanges={() =>
        changesRoute && router.push(changesRoute as never)
      }
      onPauseGoal={async () => undefined}
      onLoadMagic={loadMagic}
      onRunMagic={async (template) => {
        if (!trackerClient || !taskProjectSlug || !taskIdentifier) return;
        await trackerClient.runPromptTemplate(taskProjectSlug, taskIdentifier, {
          slug: template.slug,
          agent: template.agentKind as "codex" | "claude" | "cursor" | "opencode" | null,
          model: template.model,
          effort: template.effort,
          mode:
            template.mode === "plan" || template.mode === "build" || template.mode === "yolo"
              ? template.mode
              : null,
        });
      }}
      onSearchContext={searchContext}
      onResumeTurn={async () => undefined}
      onResumeGoal={async () => undefined}
      onSend={(message, contextRefs) => session.steer(message, contextRefs)}
      onSetGoalMode={async () => undefined}
      onSetGoalObjective={async () => undefined}
      onSetTurnPreferences={async () => undefined}
      onStopTurn={async () => undefined}
      onSubmitUserInput={async () => undefined}
      taskLinks={taskLinks}
      threadId={executionSessionId}
      sourceChanges={sourceChanges}
      timeline={timeline}
      title={title}
    />
  );
}

function taskContextFromPayload(payload: unknown): OrchestratorTaskContext | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const projectSlug = typeof record.project_slug === "string" ? record.project_slug.trim() : "";
  const identifier =
    typeof record.issue_identifier === "string" ? record.issue_identifier.trim() : "";
  const agentKind = typeof record.agent_kind === "string" ? record.agent_kind.trim() : "";
  return projectSlug
    ? {
        projectSlug,
        identifier: identifier || null,
        agentKind: agentKind || null,
      }
    : null;
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
