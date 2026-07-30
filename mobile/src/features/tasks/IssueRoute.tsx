import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";

import { useHostTransport } from "@/api/HostTransportContext";
import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { useTaskEvidence } from "@/features/evidence/useTaskEvidence";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import type { HostTransport } from "@/transport/HostTransport";
import type {
  EvidenceArtifact,
  EvidenceRecord,
} from "@/features/evidence/evidence-contract";
import {
  assistantThreadDiffRoute,
  hostChatRoute,
  hostTerminalRoute,
} from "@/features/sessions/session-navigation";

import { IssueScreen } from "./IssueScreen";
import { useIssueDetail } from "./useIssueDetail";

export function IssueRoute() {
  const params = useLocalSearchParams<{
    hostId?: string;
    projectSlug?: string;
    identifier?: string;
  }>();
  const router = useRouter();
  const selectedClient = useTrackerClient();
  const hostRuntime = useHostRuntime();
  const hostId = routeParam(params.hostId);
  const hostTransport = hostId ? hostRuntime.transport(hostId) : null;
  const hostClient = useMemo(
    () => (hostTransport ? createRpcTrackerClient(hostTransport) : null),
    [hostTransport],
  );
  const client = hostClient ?? selectedClient;
  const { activeProfile } = useConnection();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);
  const profileId = hostId ?? activeProfile?.hostId ?? activeProfile?.id;

  if (!client || !profileId || !projectSlug || !identifier) return null;
  return (
    <ConnectedIssueRoute
      client={client}
      hostId={hostId}
      identifier={identifier}
      profileId={profileId}
      projectSlug={projectSlug}
      router={router}
      transport={hostTransport}
    />
  );
}

function ConnectedIssueRoute({
  client,
  hostId,
  identifier,
  profileId,
  projectSlug,
  router,
  transport: routeTransport,
}: {
  client: NonNullable<ReturnType<typeof useTrackerClient>>;
  hostId: string | null;
  identifier: string;
  profileId: string;
  projectSlug: string;
  router: ReturnType<typeof useRouter>;
  transport: HostTransport | null;
}) {
  const detail = useIssueDetail({ client, profileId, projectSlug, identifier });
  const selectedTransport = useHostTransport();
  const transport = routeTransport ?? selectedTransport;
  const evidence = useTaskEvidence({ transport, projectSlug, identifier });
  const activeExecution = detail.threads.find(
    (thread) => thread.scope === "issue_execution",
  );
  const threadRoute = (suffix = "") => {
    if (detail.threadId) {
      if (hostId && suffix === "/diff") {
        const route = assistantThreadDiffRoute(detail.threadId, hostId);
        if (route) router.push(route as never);
        return;
      }
      if (hostId && suffix === "/terminal") {
        router.push(hostTerminalRoute(hostId, detail.threadId) as never);
        return;
      }
      if (hostId && !suffix) {
        router.push(hostChatRoute(hostId, detail.threadId) as never);
        return;
      }
      router.push(`/codex/session/${detail.threadId}${suffix}`);
      return;
    }
    if (!suffix) {
      router.push({
        pathname: "/codex/new-session",
        params: {
          projectSlug,
          issueIdentifier: identifier,
          agentKind: detail.issue?.agentKind ?? undefined,
          model: detail.issue?.model ?? undefined,
          effort: detail.issue?.effort ?? undefined,
        },
      });
    }
  };
  return (
    <IssueScreen
      blockers={detail.blockers}
      comments={detail.comments}
      dispatching={detail.dispatching}
      activeExecution={activeExecution}
      error={detail.error}
      evidenceCount={evidence.records.length}
      evidenceError={evidence.error}
      evidenceLoading={evidence.loading}
      evidenceRecords={evidence.records}
      issue={detail.issue}
      loading={detail.loading}
      pullRequestError={detail.pullRequestError}
      pullRequests={detail.pullRequests}
      onAddComment={detail.addComment}
      onBack={() => router.back()}
      onDispatch={detail.dispatch}
      onGoalAction={detail.goalAction}
      onCreateSubtask={detail.createSubtask}
      onCreateSession={() =>
        router.push({
          pathname: "/codex/new-session",
          params: {
            projectSlug,
            issueIdentifier: identifier,
            agentKind: detail.issue?.agentKind ?? undefined,
            model: detail.issue?.model ?? undefined,
            effort: detail.issue?.effort ?? undefined,
          },
        })
      }
      onOpenDiff={() => threadRoute("/diff")}
      onOpenEvidence={() =>
        router.push(
          `/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}/evidence`,
        )
      }
      onOpenExecution={(thread) => {
        if (hostId) {
          router.push(
            hostChatRoute(
              hostId,
              thread.id,
              thread.title || undefined,
            ) as never,
          );
          return;
        }
        router.push(`/codex/session/${thread.id}`);
      }}
      onOpenEvidenceArtifact={(artifact, record) =>
        openEvidenceArtifact(
          router,
          hostId,
          projectSlug,
          identifier,
          artifact,
          record,
        )
      }
      onOpenFiles={() => threadRoute("/files")}
      onOpenPreview={() => threadRoute("/preview")}
      onOpenPullRequest={() =>
        router.push(
          `/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}/pull-request`,
        )
      }
      onOpenRelatedTask={(relatedIdentifier) =>
        router.push(
          `/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(relatedIdentifier)}`,
        )
      }
      onOpenSession={(thread) => {
        if (thread && hostId) {
          router.push(
            hostChatRoute(
              hostId,
              thread.id,
              thread.title || undefined,
            ) as never,
          );
          return;
        }
        if (thread) {
          router.push(`/codex/session/${thread.id}`);
          return;
        }
        threadRoute();
      }}
      onRunOrchestration={() => detail.dispatch("orchestrate")}
      onOpenTerminal={() => threadRoute("/terminal")}
      onRefresh={() => void detail.refresh()}
      onSave={detail.save}
      saving={detail.saving}
      subtasks={detail.subtasks}
      threads={detail.threads}
    />
  );
}

function openEvidenceArtifact(
  router: ReturnType<typeof useRouter>,
  hostId: string | null,
  projectSlug: string,
  identifier: string,
  artifact: EvidenceArtifact,
  record: EvidenceRecord,
) {
  router.push({
    pathname: (hostId
      ? "/h/[hostId]/issue/[projectSlug]/[identifier]/evidence/[runId]"
      : "/issue/[projectSlug]/[identifier]/evidence/[runId]") as never,
    params: {
      ...(hostId ? { hostId } : {}),
      projectSlug,
      identifier,
      runId: record.runId,
      artifactPath: artifact.path,
    },
  });
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}
