import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useHostTransport } from "@/api/HostTransportContext";
import { useConnection } from "@/auth/ConnectionProvider";
import { orchestratorRunRoute } from "@/features/orchestrator/orchestrator-executions";
import { hostChatRoute } from "@/features/sessions/session-navigation";

import type { ComparisonCell, ComparisonCellId, ComparisonPreview } from "./comparison-contract";
import { ComparisonScreen } from "./ComparisonScreen";
import { useComparison } from "./useComparison";

export function ComparisonRoute() {
  const params = useLocalSearchParams<{
    projectSlug?: string | string[];
    identifier?: string | string[];
  }>();
  const router = useRouter();
  const transport = useHostTransport();
  const { activeHostId } = useConnection();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);
  const [starting, setStarting] = useState(false);
  const [retryingCellId, setRetryingCellId] = useState<ComparisonCellId | null>(null);

  if (!projectSlug || !identifier) return null;

  return (
    <ConnectedComparisonRoute
      activeHostId={activeHostId}
      identifier={identifier}
      projectSlug={projectSlug}
      retryingCellId={retryingCellId}
      router={router}
      setRetryingCellId={setRetryingCellId}
      setStarting={setStarting}
      starting={starting}
      transport={transport}
    />
  );
}

function ConnectedComparisonRoute({
  activeHostId,
  identifier,
  projectSlug,
  retryingCellId,
  router,
  setRetryingCellId,
  setStarting,
  starting,
  transport,
}: {
  activeHostId: string | null;
  identifier: string;
  projectSlug: string;
  retryingCellId: ComparisonCellId | null;
  router: ReturnType<typeof useRouter>;
  setRetryingCellId(value: ComparisonCellId | null): void;
  setStarting(value: boolean): void;
  starting: boolean;
  transport: NonNullable<ReturnType<typeof useHostTransport>> | null;
}) {
  const comparison = useComparison({ transport, projectSlug, identifier });
  const hostId = transport?.hostId ?? activeHostId;

  const start = async () => {
    setStarting(true);
    try {
      await comparison.start(requestKey("start", hostId, identifier));
    } finally {
      setStarting(false);
    }
  };

  const retryCell = async (cellId: ComparisonCellId) => {
    setRetryingCellId(cellId);
    try {
      await comparison.retryCell(cellId, requestKey(`retry:${cellId}`, hostId, identifier));
    } finally {
      setRetryingCellId(null);
    }
  };

  return (
    <ComparisonScreen
      cached={comparison.cached}
      connectionState={comparison.connectionState}
      error={comparison.error}
      onBack={() => router.back()}
      onOpenEvidence={(cell, record) =>
        router.push(
          `/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(
            identifier,
          )}/evidence/${encodeURIComponent(record.runId)}?cellId=${encodeURIComponent(cell.id)}`,
        )
      }
      onOpenLog={(cell) => openLog(router, hostId, cell)}
      onOpenPreview={(cell, preview) => openPreview(router, cell, preview)}
      onRetry={comparison.reconnect}
      onRetryCell={(cellId) => void retryCell(cellId)}
      onStart={() => void start()}
      retryingCellId={retryingCellId}
      snapshot={comparison.snapshot}
      starting={starting}
    />
  );
}

function openLog(
  router: ReturnType<typeof useRouter>,
  hostId: string | null,
  cell: ComparisonCell,
): void {
  if (!hostId) return;
  if (cell.path === "session" && cell.threadId) {
    router.push(hostChatRoute(hostId, cell.threadId, cell.issueIdentifier ?? cell.id) as never);
    return;
  }
  if (cell.path === "orchestrator" && cell.executionSessionId) {
    router.push(
      orchestratorRunRoute(
        hostId,
        cell.executionSessionId,
        cell.issueIdentifier ?? cell.id,
        cell.provider,
        cell.status,
      ) as never,
    );
  }
}

function openPreview(
  router: ReturnType<typeof useRouter>,
  cell: ComparisonCell,
  _preview: ComparisonPreview,
): void {
  const sessionId = cell.threadId ?? cell.executionSessionId;
  if (sessionId) router.push(`/codex/session/${sessionId}/preview` as never);
}

function requestKey(action: string, hostId: string | null, identifier: string): string {
  const nonce =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `mobile:${hostId ?? "host"}:${identifier}:${action}:${nonce}`;
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}
