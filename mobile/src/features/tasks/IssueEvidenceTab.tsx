import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { EvidenceArtifact, EvidenceRecord } from "@/features/evidence/evidence-contract";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export function IssueEvidenceTab({
  error,
  loading,
  onOpen,
  records,
}: {
  error: string | null;
  loading: boolean;
  onOpen(): void;
  records: EvidenceRecord[];
}) {
  const { colors } = useAppTheme();
  const record = records[0] ?? null;
  if (!record) {
    return (
      <View style={styles.state}>
        <Text style={{ color: error ? colors.statusRed : colors.textMuted }}>
          {error ?? (loading ? "Loading evidence" : "No evidence has been recorded.")}
        </Text>
      </View>
    );
  }

  const artifacts = record.manifest.runs.flatMap((run) => run.artifacts);
  const model =
    record.provenance?.resolvedModel ?? record.provenance?.requestedModel ?? "Unknown model";
  const effort =
    record.provenance?.resolvedEffort ?? record.provenance?.requestedEffort ?? "default";
  const passed = record.status.toLowerCase() === "passed";

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>Latest execution</Text>
          <Text style={{ color: colors.textMuted }}>{record.runId}</Text>
        </View>
        <View
          style={[
            styles.status,
            { backgroundColor: `${passed ? colors.statusGreen : colors.statusRed}20` },
          ]}
        >
          <View
            style={[
              styles.dot,
              { backgroundColor: passed ? colors.statusGreen : colors.statusRed },
            ]}
          />
          <Text style={{ color: colors.textPrimary }}>{passed ? "Passed" : "Failed"}</Text>
        </View>
      </View>
      <View style={styles.facts}>
        <Fact label="Provenance" value={`${model} · ${effort}`} />
        <Fact label="Agent" value={record.provenance?.agentKind ?? "Unknown"} />
        <Fact label="Runs" value={String(record.manifest.runs.length)} />
      </View>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Artifacts</Text>
      <View style={styles.artifacts}>
        {artifacts.map((artifact, index) => (
          <ArtifactTile artifact={artifact} key={`${artifact.path}:${index}`} />
        ))}
      </View>
      <Pressable
        accessibilityLabel="View complete evidence run"
        accessibilityRole="button"
        onPress={onOpen}
        style={[styles.open, { backgroundColor: colors.textPrimary }]}
      >
        <Text style={{ color: colors.bgBase }}>View complete run</Text>
      </Pressable>
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.fact}>
      <Text style={{ color: colors.textMuted }}>{label}</Text>
      <Text style={{ color: colors.textPrimary }}>{value}</Text>
    </View>
  );
}

function ArtifactTile({ artifact }: { artifact: EvidenceArtifact }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.artifact, { backgroundColor: colors.bgRaised }]}>
      <Text style={{ color: colors.textMuted }}>{artifactKindLabel(artifact.kind)}</Text>
      <Text numberOfLines={2} style={{ color: colors.textPrimary }}>
        {artifact.label}
      </Text>
    </View>
  );
}

function artifactKindLabel(kind: EvidenceArtifact["kind"]): string {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "trace") return "Trace";
  return "Report";
}

const styles = StyleSheet.create({
  artifact: { borderRadius: radii.md, flexBasis: "47%", gap: spacing.xs, padding: spacing.md },
  artifacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  dot: { borderRadius: radii.pill, height: 8, width: 8 },
  fact: { gap: spacing.xxs },
  facts: { gap: spacing.sm },
  grow: { flex: 1 },
  heading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  open: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 44,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  state: { alignItems: "center", padding: spacing.xl },
  status: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
