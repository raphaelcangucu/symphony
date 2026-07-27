import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useHostTransport } from "@/api/HostTransportContext";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { StateView } from "@/components/StateView";
import type { ComparisonCell } from "@/features/comparisons/comparison-contract";
import { useComparison } from "@/features/comparisons/useComparison";
import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import { EvidenceArtifactScreen, type EvidenceArtifactDownload } from "./EvidenceArtifactScreen";
import { EvidenceGallery } from "./EvidenceGallery";
import type { EvidenceArtifact, EvidenceRecord } from "./evidence-contract";
import { downloadEvidenceArtifact } from "./downloadEvidenceArtifact";

type Selection = {
  artifact: EvidenceArtifact;
  record: EvidenceRecord;
};

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
    cellId?: string | string[];
  }>();
  const router = useRouter();
  const transport = useHostTransport();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);
  const runId = routeParam(params.runId);
  const cellId = routeParam(params.cellId);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [download, setDownload] = useState(idleDownload);
  const [retry, setRetry] = useState(0);
  const comparison = useComparison({
    transport,
    projectSlug: projectSlug ?? "",
    identifier: identifier ?? "",
  });
  const match = useMemo(
    () => findEvidence(comparison.snapshot?.cells ?? [], cellId, runId),
    [cellId, comparison.snapshot?.cells, runId],
  );

  useEffect(() => {
    if (!selection || !transport || !projectSlug || !match?.cell.issueIdentifier) return;
    const controller = new AbortController();
    setDownload({ ...idleDownload, status: "loading" });

    void downloadEvidenceArtifact({
      transport,
      hostId: transport.hostId,
      projectSlug,
      identifier: match.cell.issueIdentifier,
      runId: selection.record.runId,
      artifactPath: selection.artifact.path,
      signal: controller.signal,
    })
      .then(async (result) => {
        const text = selection.artifact.kind === "report" ? await readTextFile(result.uri) : null;
        if (!controller.signal.aborted) {
          setDownload({
            status: "ready",
            uri: result.uri,
            text,
            error: null,
            cached: comparison.connectionState === "offline",
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
  }, [
    comparison.connectionState,
    match?.cell.issueIdentifier,
    projectSlug,
    retry,
    selection,
    transport,
  ]);

  if (!projectSlug || !identifier || !runId || !cellId) return null;

  if (selection) {
    return (
      <EvidenceArtifactScreen
        artifact={selection.artifact}
        download={download}
        onBack={() => {
          setSelection(null);
          setDownload(idleDownload);
        }}
        onRetry={() => setRetry((value) => value + 1)}
        onShare={(uri) => void Share.share({ message: selection.artifact.label, url: uri })}
      />
    );
  }

  return (
    <EvidenceRunGallery
      cached={comparison.cached}
      cell={match?.cell ?? null}
      connectionState={comparison.connectionState}
      error={comparison.error}
      onBack={() => router.back()}
      onOpenArtifact={(artifact, record) => setSelection({ artifact, record })}
      onRetry={comparison.reconnect}
      record={match?.record ?? null}
    />
  );
}

function EvidenceRunGallery({
  cell,
  record,
  cached,
  connectionState,
  error,
  onBack,
  onRetry,
  onOpenArtifact,
}: {
  cell: ComparisonCell | null;
  record: EvidenceRecord | null;
  cached: boolean;
  connectionState: "connecting" | "live" | "offline";
  error: string | null;
  onBack(): void;
  onRetry(): void;
  onOpenArtifact(artifact: EvidenceArtifact, record: EvidenceRecord): void;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={[styles.header, { borderColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.back}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Durable evidence</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {cell ? cellLabel(cell) : "Loading comparison run"}
          </Text>
        </View>
        <ConnectionBadge state={cached ? "cached" : connectionState} />
      </View>
      {record && cell ? (
        <ScrollView contentContainerStyle={styles.content}>
          <EvidenceGallery
            groups={[{ cellLabel: cellLabel(cell), record }]}
            onOpenArtifact={onOpenArtifact}
          />
        </ScrollView>
      ) : error ? (
        <StateView
          actionLabel="Reconnect"
          description={error}
          kind="error"
          onAction={onRetry}
          title="Evidence unavailable"
        />
      ) : (
        <StateView
          description="Waiting for the selected host to publish this durable run."
          kind={connectionState === "connecting" ? "loading" : "empty"}
          title="Loading evidence"
        />
      )}
    </SafeAreaView>
  );
}

function findEvidence(
  cells: ComparisonCell[],
  cellId: string | null,
  runId: string | null,
): { cell: ComparisonCell; record: EvidenceRecord } | null {
  const cell = cells.find((candidate) => candidate.id === cellId);
  const record = cell?.evidence.find((candidate) => candidate.runId === runId);
  return cell && record ? { cell, record } : null;
}

async function readTextFile(uri: string): Promise<string> {
  const { File } = await import("expo-file-system");
  return new File(uri).text();
}

function cellLabel(cell: ComparisonCell): string {
  const path = cell.path === "session" ? "Session" : "Orchestrator";
  const provider =
    cell.provider === "codex" ? "Codex" : cell.provider === "cursor" ? "Cursor" : "Claude";
  return `${path} · ${provider}`;
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to download durable evidence";
}

const styles = StyleSheet.create({
  back: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  heading: { flex: 1 },
  safeArea: { flex: 1 },
  subtitle: { fontSize: 12, marginTop: 2 },
  title: { fontSize: 18, fontWeight: "800" },
});
