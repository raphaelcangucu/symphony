import { Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { EvidenceArtifact, EvidenceRecord, EvidenceRun } from "./evidence-contract";

export type EvidenceGalleryGroup = {
  label: string;
  record: EvidenceRecord;
};

export function EvidenceGallery({
  groups,
  onOpenArtifact,
  onOpenLog,
}: {
  groups: EvidenceGalleryGroup[];
  onOpenArtifact(artifact: EvidenceArtifact, record: EvidenceRecord): void;
  onOpenLog?(record: EvidenceRecord): void;
}) {
  const { colors } = useAppTheme();

  if (groups.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.textMuted }]}>
        No durable evidence is available yet.
      </Text>
    );
  }

  return (
    <View style={styles.groups}>
      {groups.map(({ label, record }) => (
        <View
          key={`${label}:${record.runId}`}
          style={[
            styles.group,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.cell, { color: colors.textPrimary }]}>{label}</Text>
          <Text style={[styles.run, { color: colors.statusGreen }]}>
            {record.runId} · {record.status}
          </Text>
          {record.provenance ? (
            <View style={styles.provenance}>
              <Text style={[styles.proof, { color: colors.textSecondary }]}>
                Requested{" "}
                {modelEffort(record.provenance.requestedModel, record.provenance.requestedEffort)}
              </Text>
              <Text style={[styles.proof, { color: colors.textMuted }]}>
                Resolved{" "}
                {modelEffort(record.provenance.resolvedModel, record.provenance.resolvedEffort)}
              </Text>
            </View>
          ) : null}
          {onOpenLog && record.provenance?.executionPath ? (
            <Pressable
              accessibilityLabel={
                record.provenance.executionPath === "session"
                  ? "Open session log"
                  : "Open orchestrator log"
              }
              accessibilityRole="button"
              onPress={() => onOpenLog(record)}
              style={[styles.logAction, { borderColor: colors.borderStrong }]}
            >
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "800" }}>
                {record.provenance.executionPath === "session"
                  ? "Open session log"
                  : "Open orchestrator log"}
              </Text>
            </Pressable>
          ) : null}
          {record.manifest.runs.map((run, index) => (
            <RunEvidence
              key={`${record.runId}:${run.taskId ?? run.kind}:${index}`}
              onOpenArtifact={(artifact) => onOpenArtifact(artifact, record)}
              run={run}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function RunEvidence({
  run,
  onOpenArtifact,
}: {
  run: EvidenceRun;
  onOpenArtifact(artifact: EvidenceArtifact): void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.check, { borderColor: colors.borderSubtle }]}>
      <Text style={[styles.checkTitle, { color: colors.textPrimary }]}>
        {run.taskTitle ?? kindLabel(run.kind)} · {durationLabel(run.durationMs)}
      </Text>
      <Text selectable style={[styles.command, { color: colors.textSecondary }]}>
        {run.command}
      </Text>
      {Object.keys(run.proof).length ? (
        <Text selectable style={[styles.proof, { color: colors.textMuted }]}>
          {proofLabel(run.proof)}
        </Text>
      ) : null}
      <View style={styles.artifacts}>
        {run.artifacts.map((artifact) => (
          <Pressable
            accessibilityLabel={`Open ${artifact.label}`}
            accessibilityRole="button"
            key={`${artifact.kind}:${artifact.path}`}
            onPress={() => onOpenArtifact(artifact)}
            style={({ pressed }) => [
              styles.artifact,
              {
                backgroundColor: pressed ? colors.bgPressed : colors.bgRaised,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.artifactKind, { color: colors.accent }]}>
              {kindLabel(artifact.kind)}
            </Text>
            <Text numberOfLines={1} style={[styles.artifactLabel, { color: colors.textPrimary }]}>
              {artifact.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function proofLabel(proof: Record<string, unknown>): string {
  return Object.entries(proof)
    .map(([key, value]) => `${key}: ${primitiveLabel(value)}`)
    .join(" · ");
}

function primitiveLabel(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return "duration unavailable";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function modelEffort(model: string | null, effort: string | null): string {
  if (!model) return "unavailable";
  return effort ? `${model} · ${effort}` : model;
}

function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

const styles = StyleSheet.create({
  artifact: {
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 2,
    minWidth: 116,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  artifactKind: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  artifactLabel: { fontSize: 13, fontWeight: "700" },
  artifacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  cell: { fontSize: 17, fontWeight: "800" },
  check: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  checkTitle: { fontSize: 14, fontWeight: "800" },
  command: { fontFamily: "monospace", fontSize: 12 },
  empty: { fontSize: 14, lineHeight: 20, padding: spacing.md },
  group: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  groups: { gap: spacing.sm },
  logAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  proof: { fontSize: 12, lineHeight: 17 },
  provenance: { gap: 2 },
  run: { fontSize: 12, fontWeight: "800" },
});
