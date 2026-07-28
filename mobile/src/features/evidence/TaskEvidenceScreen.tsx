import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import { StateView } from "@/components/StateView";
import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { EvidenceArtifact, EvidenceRecord } from "./evidence-contract";
import { EvidenceGallery } from "./EvidenceGallery";

export type EvidenceConnectionState = "connecting" | "live" | "offline";

export function TaskEvidenceScreen({
  identifier,
  records,
  loading,
  error,
  cached,
  connectionState,
  onBack,
  onRefresh,
  onOpenLog,
  onOpenArtifact,
}: {
  identifier: string;
  records: EvidenceRecord[];
  loading: boolean;
  error: string | null;
  cached: boolean;
  connectionState: EvidenceConnectionState;
  onBack(): void;
  onRefresh(): void;
  onOpenLog(record: EvidenceRecord): void;
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
          <Text style={[styles.title, { color: colors.textPrimary }]}>{identifier} evidence</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Durable task runs from this Symphony host
          </Text>
        </View>
        <ConnectionBadge state={cached ? "cached" : connectionState} />
      </View>

      {loading && records.length === 0 ? (
        <StateView kind="loading" title="Loading evidence" />
      ) : error && records.length === 0 ? (
        <StateView
          actionLabel="Retry"
          description={error}
          kind="error"
          onAction={onRefresh}
          title="Evidence unavailable"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {cached ? (
            <Text style={[styles.cached, { color: colors.statusAmber }]}>
              Offline · showing evidence cached on this device
            </Text>
          ) : null}
          <EvidenceGallery
            groups={records.map((record) => ({
              label: recordLabel(record),
              record,
            }))}
            onOpenArtifact={onOpenArtifact}
            onOpenLog={onOpenLog}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function recordLabel(record: EvidenceRecord): string {
  const path =
    record.provenance?.executionPath === "session"
      ? "Session"
      : record.provenance?.executionPath === "orchestrator"
        ? "Orchestrator"
        : "Task run";
  const agent = record.provenance?.agentKind;
  return agent ? `${path} · ${agentLabel(agent)}` : path;
}

function agentLabel(agent: string): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

const styles = StyleSheet.create({
  back: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  cached: { fontSize: 13, fontWeight: "800" },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
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
