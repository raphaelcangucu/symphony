import { useLocalSearchParams, useRouter } from "expo-router";

import { useHostTransport, useHostTransportState } from "@/api/HostTransportContext";
import { orchestratorRunRoute } from "@/features/orchestrator/orchestrator-executions";

import type { EvidenceArtifact, EvidenceRecord } from "./evidence-contract";
import { TaskEvidenceScreen } from "./TaskEvidenceScreen";
import { useTaskEvidence } from "./useTaskEvidence";

export function TaskEvidenceRoute() {
  const params = useLocalSearchParams<{
    projectSlug?: string | string[];
    identifier?: string | string[];
  }>();
  const router = useRouter();
  const transport = useHostTransport();
  const transportState = useHostTransportState();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);
  const evidence = useTaskEvidence({
    transport,
    projectSlug: projectSlug ?? "",
    identifier: identifier ?? "",
  });

  if (!projectSlug || !identifier) return null;

  return (
    <TaskEvidenceScreen
      cached={evidence.cached}
      connectionState={connectionState(transportState?.status)}
      error={evidence.error}
      identifier={identifier}
      loading={evidence.loading}
      onBack={() => router.back()}
      onOpenArtifact={(artifact, record) =>
        openArtifact(router, projectSlug, identifier, artifact, record)
      }
      onOpenLog={(record) => openLog(router, transport?.hostId, identifier, record)}
      onRefresh={() => {
        transport?.reconnect();
        void evidence.refresh();
      }}
      records={evidence.records}
    />
  );
}

function openArtifact(
  router: ReturnType<typeof useRouter>,
  projectSlug: string,
  identifier: string,
  artifact: EvidenceArtifact,
  record: EvidenceRecord,
) {
  router.push({
    pathname: "/codex/issue/[projectSlug]/[identifier]/evidence/[runId]",
    params: {
      projectSlug,
      identifier,
      runId: record.runId,
      artifactPath: artifact.path,
    },
  });
}

function openLog(
  router: ReturnType<typeof useRouter>,
  hostId: string | undefined,
  identifier: string,
  record: EvidenceRecord,
) {
  const provenance = record.provenance;
  if (provenance?.executionPath === "session" && provenance.threadId) {
    router.push(`/codex/session/${provenance.threadId}`);
    return;
  }
  if (hostId && provenance?.executionSessionId) {
    router.push(
      orchestratorRunRoute(
        hostId,
        provenance.executionSessionId,
        identifier,
        provenance.agentKind,
        record.status,
      ) as never,
    );
  }
}

function connectionState(
  status:
    | "connecting"
    | "handshaking"
    | "authenticating"
    | "online"
    | "revoked"
    | "host_key_mismatch"
    | "protocol_incompatible"
    | "offline"
    | undefined,
): "connecting" | "live" | "offline" {
  if (status === "online") return "live";
  if (status === "connecting" || status === "handshaking" || status === "authenticating") {
    return "connecting";
  }
  return "offline";
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}
