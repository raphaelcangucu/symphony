import { FileText, Image as ImageIcon, Play, Route, ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { EvidenceArtifact, EvidenceRecord } from "@/features/evidence/evidence-contract";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export function IssueEvidenceTab({
  error,
  loading,
  onOpen,
  onOpenArtifact,
  records,
}: {
  error: string | null;
  loading: boolean;
  onOpen(): void;
  onOpenArtifact(artifact: EvidenceArtifact, record: EvidenceRecord): void;
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
  const visualArtifacts = artifacts.filter(
    (artifact) => artifact.kind === "image" || artifact.kind === "video",
  );
  const reportArtifacts = artifacts.filter((artifact) => artifact.kind === "report");
  const traceArtifacts = artifacts.filter((artifact) => artifact.kind === "trace");
  const model =
    record.provenance?.resolvedModel ?? record.provenance?.requestedModel ?? "Unknown model";
  const effort =
    record.provenance?.resolvedEffort ?? record.provenance?.requestedEffort ?? "default";
  const passed = record.status.toLowerCase() === "passed";

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View
        style={[
          styles.executionCard,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <Text style={[styles.eyebrow, { color: colors.textMuted }]}>Latest execution</Text>
        <View style={styles.heading}>
          <View style={styles.grow}>
            <Text style={[styles.executionTitle, { color: colors.textPrimary }]}>
              {passed ? "Evidence is ready" : "Evidence needs attention"}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textMuted }}>
              {record.runId}
            </Text>
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
            <Text
              style={{ color: passed ? colors.statusGreen : colors.statusRed, fontWeight: "800" }}
            >
              {passed ? "Passed" : "Failed"}
            </Text>
          </View>
        </View>
        <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>
          {artifacts.length} durable artifact{artifacts.length === 1 ? "" : "s"} · tap any card to
          inspect it.
        </Text>
      </View>
      <View style={styles.facts}>
        <Fact label="Model" value={`${model} · ${effort}`} />
        <Fact label="Agent" value={record.provenance?.agentKind ?? "Unknown"} />
        <Fact label="Checks" value={String(record.manifest.runs.length)} />
      </View>
      {visualArtifacts.length > 0 ? (
        <ArtifactSection
          artifacts={visualArtifacts}
          color={colors.textPrimary}
          description="Screenshots and recordings from the real run"
          icon={<ImageIcon color={colors.accent} size={18} />}
          onOpenArtifact={(artifact) => onOpenArtifact(artifact, record)}
          title="Visual proof"
        />
      ) : null}
      {reportArtifacts.length > 0 ? (
        <ArtifactSection
          artifacts={reportArtifacts}
          color={colors.textPrimary}
          description="Logs, results and provenance you can read in the app"
          icon={<FileText color={colors.accent} size={18} />}
          onOpenArtifact={(artifact) => onOpenArtifact(artifact, record)}
          title="Reports"
        />
      ) : null}
      {traceArtifacts.length > 0 ? (
        <ArtifactSection
          artifacts={traceArtifacts}
          color={colors.textPrimary}
          description="Replay archive for the browser run"
          icon={<Route color={colors.accent} size={18} />}
          onOpenArtifact={(artifact) => onOpenArtifact(artifact, record)}
          title="Trace"
        />
      ) : null}
      <Pressable
        accessibilityLabel="View complete evidence run"
        accessibilityRole="button"
        onPress={onOpen}
        style={[styles.open, { backgroundColor: colors.textPrimary }]}
      >
        <Text style={{ color: colors.bgBase, fontWeight: "800" }}>View complete execution</Text>
        <ChevronRight color={colors.bgBase} size={18} />
      </Pressable>
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.fact, { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle }]}
    >
      <Text style={[styles.factLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text numberOfLines={2} style={{ color: colors.textPrimary, fontWeight: "700" }}>
        {value}
      </Text>
    </View>
  );
}

function ArtifactSection({
  artifacts,
  color,
  description,
  icon,
  onOpenArtifact,
  title,
}: {
  artifacts: EvidenceArtifact[];
  color: string;
  description: string;
  icon: ReactNode;
  onOpenArtifact(artifact: EvidenceArtifact): void;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.artifactSection}>
      <View style={styles.sectionHeading}>
        <View style={[styles.sectionIcon, { backgroundColor: `${colors.accent}1A` }]}>{icon}</View>
        <View style={styles.grow}>
          <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{description}</Text>
        </View>
      </View>
      <View style={styles.artifacts}>
        {artifacts.map((artifact, index) => (
          <ArtifactTile
            artifact={artifact}
            key={`${artifact.path}:${index}`}
            onPress={() => onOpenArtifact(artifact)}
          />
        ))}
      </View>
    </View>
  );
}

function ArtifactTile({ artifact, onPress }: { artifact: EvidenceArtifact; onPress(): void }) {
  const { colors } = useAppTheme();
  const Icon = artifact.kind === "video" ? Play : artifact.kind === "image" ? ImageIcon : FileText;
  const kind =
    artifact.kind === "video"
      ? "Video"
      : artifact.kind === "image"
        ? "Image"
        : artifact.kind === "trace"
          ? "Trace"
          : "Report";
  return (
    <Pressable
      accessibilityLabel={`Open evidence ${artifact.label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.artifact,
        {
          backgroundColor: pressed ? colors.bgPressed : colors.bgRaised,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.artifactTopline}>
        <View style={[styles.kindIcon, { backgroundColor: `${colors.accent}1A` }]}>
          <Icon color={colors.accent} size={15} />
        </View>
        <Text style={[styles.kind, { color: colors.textMuted }]}>{kind}</Text>
        <ChevronRight color={colors.textMuted} size={16} />
      </View>
      <Text numberOfLines={2} style={[styles.artifactTitle, { color: colors.textPrimary }]}>
        {artifact.label}
      </Text>
      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>Open details</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  artifact: {
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 142,
    padding: spacing.md,
  },
  artifactSection: { gap: spacing.sm },
  artifactTitle: { fontSize: 16, fontWeight: "700", lineHeight: 21 },
  artifactTopline: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  artifacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  dot: { borderRadius: radii.pill, height: 8, width: 8 },
  executionCard: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  executionTitle: { fontSize: 18, fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  fact: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: "30%",
    flexGrow: 1,
    gap: spacing.xxs,
    minHeight: 66,
    padding: spacing.sm,
  },
  factLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  grow: { flex: 1 },
  heading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  kind: { flex: 1, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  kindIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  open: {
    alignItems: "center",
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 44,
  },
  sectionHeading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  sectionIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
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
