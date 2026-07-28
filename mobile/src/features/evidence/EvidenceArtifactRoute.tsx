import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Share } from "react-native";

import { useHostTransport } from "@/api/HostTransportContext";
import { StateView } from "@/components/StateView";

import { EvidenceArtifactScreen, type EvidenceArtifactDownload } from "./EvidenceArtifactScreen";
import type { EvidenceArtifact } from "./evidence-contract";
import { downloadEvidenceArtifact } from "./downloadEvidenceArtifact";
import { useTaskEvidence } from "./useTaskEvidence";

const idleDownload: EvidenceArtifactDownload = {
  status: "idle",
  uri: null,
  text: null,
  error: null,
  cached: false,
};

export function EvidenceArtifactRoute() {
  const params = useLocalSearchParams<{
    projectSlug?: string | string[];
    identifier?: string | string[];
    runId?: string | string[];
    artifactPath?: string | string[];
  }>();
  const router = useRouter();
  const transport = useHostTransport();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);
  const runId = routeParam(params.runId);
  const artifactPath = routeParam(params.artifactPath);
  const evidence = useTaskEvidence({
    transport,
    projectSlug: projectSlug ?? "",
    identifier: identifier ?? "",
  });
  const artifact = useMemo(
    () => findArtifact(evidence.records, runId, artifactPath),
    [artifactPath, evidence.records, runId],
  );
  const [download, setDownload] = useState(idleDownload);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!artifact || !transport || !projectSlug || !identifier || !runId) return;
    const controller = new AbortController();
    setDownload({ ...idleDownload, status: "loading" });

    void downloadEvidenceArtifact({
      transport,
      hostId: transport.hostId,
      projectSlug,
      identifier,
      runId,
      artifactPath: artifact.path,
      signal: controller.signal,
    })
      .then(async (result) => {
        const text = artifact.kind === "report" ? await readTextFile(result.uri) : null;
        if (!controller.signal.aborted) {
          setDownload({
            status: "ready",
            uri: result.uri,
            text,
            error: null,
            cached: evidence.cached,
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDownload({
            status: "error",
            uri: null,
            text: null,
            error: errorMessage(error),
            cached: false,
          });
        }
      });

    return () => controller.abort();
  }, [artifact, evidence.cached, identifier, projectSlug, retry, runId, transport]);

  if (!projectSlug || !identifier || !runId || !artifactPath) return null;

  if (!artifact) {
    if (evidence.error) {
      return (
        <StateView
          actionLabel="Retry"
          description={evidence.error}
          kind="error"
          onAction={() => void evidence.refresh()}
          title="Evidence unavailable"
        />
      );
    }
    return (
      <StateView
        kind={evidence.loading ? "loading" : "empty"}
        title={evidence.loading ? "Loading evidence" : "Artifact not found"}
      />
    );
  }

  return (
    <EvidenceArtifactScreen
      artifact={artifact}
      download={download}
      onBack={() => router.back()}
      onRetry={() => setRetry((value) => value + 1)}
      onShare={(uri) => void Share.share({ message: artifact.label, url: uri })}
    />
  );
}

function findArtifact(
  records: ReturnType<typeof useTaskEvidence>["records"],
  runId: string | null,
  artifactPath: string | null,
): EvidenceArtifact | null {
  if (!runId || !artifactPath) return null;
  const record = records.find((candidate) => candidate.runId === runId);
  return (
    record?.manifest.runs
      .flatMap((run) => run.artifacts)
      .find((candidate) => candidate.path === artifactPath) ?? null
  );
}

async function readTextFile(uri: string): Promise<string> {
  const { File } = await import("expo-file-system");
  return new File(uri).text();
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to download durable evidence";
}
