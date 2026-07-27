import { ArrowLeft, ChevronRight, RotateCw } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import type { EvidenceRecord } from "@/features/evidence/evidence-contract";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import {
  canRetryComparisonCell,
  type ComparisonCell,
  type ComparisonCellId,
  type ComparisonPreview,
  type ComparisonSnapshot,
} from "./comparison-contract";
import type { ComparisonConnectionState } from "./rpc-comparison";

type ComparisonScreenProps = {
  snapshot: ComparisonSnapshot | null;
  connectionState: ComparisonConnectionState;
  cached: boolean;
  error: string | null;
  starting: boolean;
  retryingCellId: ComparisonCellId | null;
  onBack(): void;
  onStart(): void;
  onRetry(): void;
  onRetryCell(cellId: ComparisonCellId): void;
  onOpenLog(cell: ComparisonCell): void;
  onOpenPreview(cell: ComparisonCell, preview: ComparisonPreview): void;
  onOpenEvidence(cell: ComparisonCell, evidence: EvidenceRecord): void;
};

export function ComparisonScreen({
  snapshot,
  connectionState,
  cached,
  error,
  starting,
  retryingCellId,
  onBack,
  onStart,
  onRetry,
  onRetryCell,
  onOpenLog,
  onOpenPreview,
  onOpenEvidence,
}: ComparisonScreenProps) {
  const { colors } = useAppTheme();
  const cells = snapshot?.cells ?? [];
  const started = cells.some((cell) => cell.issueIdentifier !== null);
  const previews = cells.flatMap((cell) => cell.previews.map((preview) => ({ cell, preview })));
  const evidence = cells.flatMap((cell) => cell.evidence.map((record) => ({ cell, record })));

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={[styles.header, { borderColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.iconButton}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Dev10x comparison</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textMuted }]}>
            {snapshot?.identifier ?? "Preparing comparison"}
          </Text>
        </View>
        <ConnectionBadge state={cached ? "cached" : connectionState} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {cached ? (
          <Text style={[styles.cached, { color: colors.statusAmber }]}>
            Offline · cached evidence
          </Text>
        ) : null}
        {error ? (
          <View style={[styles.error, { borderColor: colors.statusRed }]}>
            <Text style={{ color: colors.statusRed, flex: 1 }}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={onRetry}>
              <Text style={{ color: colors.accent, fontWeight: "700" }}>Reconnect</Text>
            </Pressable>
          </View>
        ) : null}

        <Section title="Overview">
          <View
            style={[
              styles.overview,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <Text style={[styles.progress, { color: colors.textPrimary }]}>
              {snapshot?.progress.terminal ?? 0}/6 complete
            </Text>
            <Text style={[styles.overviewMeta, { color: colors.textSecondary }]}>
              {snapshot?.progress.passed ?? 0} passed · {snapshot?.progress.failed ?? 0} failed
            </Text>
            {!started ? (
              <PrimaryAction
                disabled={starting || connectionState === "offline"}
                label={starting ? "Starting real runs…" : "Run comparison"}
                onPress={onStart}
              />
            ) : null}
          </View>
        </Section>

        <Section title="Runs">
          {cells.map((cell) => (
            <CellCard
              cell={cell}
              key={cell.id}
              onOpenLog={onOpenLog}
              onRetryCell={onRetryCell}
              retrying={retryingCellId === cell.id}
            />
          ))}
        </Section>

        <Section title="Previews">
          {previews.length ? (
            previews.map(({ cell, preview }, index) => (
              <ListAction
                accessibilityLabel={`Open ${cell.id} preview`}
                key={`${cell.id}:${preview.id ?? index}`}
                label={`${cellLabel(cell)} · ${preview.status ?? "Preview"}`}
                meta={preview.url ?? (preview.port ? `Port ${preview.port}` : null)}
                onPress={() => onOpenPreview(cell, preview)}
              />
            ))
          ) : (
            <EmptyCopy>Previews from completed runs will appear here.</EmptyCopy>
          )}
        </Section>

        <Section title="Evidence">
          {evidence.length ? (
            evidence.map(({ cell, record }) => (
              <ListAction
                accessibilityLabel={`Open ${cell.id} evidence ${record.runId}`}
                key={`${cell.id}:${record.runId}`}
                label={`${cellLabel(cell)} · ${record.status}`}
                meta={`${record.manifest.runs.length} checks · ${record.runId}`}
                onPress={() => onOpenEvidence(cell, record)}
              />
            ))
          ) : (
            <EmptyCopy>Screenshots, videos, reports, and traces will appear here.</EmptyCopy>
          )}
        </Section>

        <Section title="Decision">
          <DecisionView snapshot={snapshot} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function CellCard({
  cell,
  retrying,
  onOpenLog,
  onRetryCell,
}: {
  cell: ComparisonCell;
  retrying: boolean;
  onOpenLog(cell: ComparisonCell): void;
  onRetryCell(cellId: ComparisonCellId): void;
}) {
  const { colors } = useAppTheme();
  const hasLog = cell.threadId !== null || cell.executionSessionId !== null;
  return (
    <View
      style={[styles.card, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
      testID="comparison-cell"
    >
      <View style={styles.cardHeading}>
        <View style={[styles.statusDot, { backgroundColor: statusColor(cell.status, colors) }]} />
        <View style={styles.grow}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{cellLabel(cell)}</Text>
          <Text style={[styles.status, { color: colors.textMuted }]}>
            {statusLabel(cell.status)} · Attempt {cell.attempt}
          </Text>
        </View>
      </View>
      <Text style={[styles.provenance, { color: colors.textSecondary }]}>
        Requested: {modelLabel(cell.provider)} · High
      </Text>
      <Text style={[styles.provenance, { color: colors.textSecondary }]}>
        Resolved:{" "}
        {cell.resolvedModel
          ? `${cell.resolvedModel} · ${cell.resolvedEffort ?? "provider default"}`
          : "Waiting for provider confirmation"}
      </Text>
      {cell.latestMessage ? (
        <Text numberOfLines={2} style={[styles.message, { color: colors.textMuted }]}>
          {cell.latestMessage}
        </Text>
      ) : null}
      {cell.error ? <Text style={{ color: colors.statusRed }}>{cell.error}</Text> : null}
      <View style={styles.cardActions}>
        {hasLog ? (
          <SecondaryAction
            accessibilityLabel={`Open ${cell.id} log`}
            label="Open log"
            onPress={() => onOpenLog(cell)}
          />
        ) : null}
        {canRetryComparisonCell(cell) ? (
          <SecondaryAction
            accessibilityLabel={`Retry ${cell.id}`}
            disabled={retrying}
            label={retrying ? "Retrying…" : "Retry"}
            onPress={() => onRetryCell(cell.id)}
          />
        ) : null}
      </View>
    </View>
  );
}

function DecisionView({ snapshot }: { snapshot: ComparisonSnapshot | null }) {
  const { colors } = useAppTheme();
  const decision = snapshot?.decision;
  const ranking = decision && Array.isArray(decision.ranking) ? decision.ranking : [];
  const summary = decision && typeof decision.summary === "string" ? decision.summary : null;

  if (!decision || ranking.length === 0) {
    return (
      <View style={[styles.decision, { borderColor: colors.borderSubtle }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Decision pending</Text>
        <Text style={[styles.message, { color: colors.textMuted }]}>
          Ranking unlocks after all six runs are terminal and their UI claims have durable evidence.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.decision, { borderColor: colors.statusPurple }]}>
      {ranking.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const rank = typeof entry.rank === "number" ? entry.rank : null;
        const cellId = typeof entry.cell_id === "string" ? entry.cell_id : null;
        const score = typeof entry.score === "number" ? entry.score : null;
        const cell = snapshot.cells.find((candidate) => candidate.id === cellId);
        if (!rank || !cell || score === null) return [];
        return [
          <Text key={cell.id} style={[styles.ranking, { color: colors.textPrimary }]}>
            {rank}. {pathLabel(cell.path)} · {providerLabel(cell.provider)} · {score}
          </Text>,
        ];
      })}
      {summary ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{summary}</Text>
      ) : null}
    </View>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      {children}
    </View>
  );
}

function EmptyCopy({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.empty, { color: colors.textMuted }]}>{children}</Text>;
}

function ListAction({
  accessibilityLabel,
  label,
  meta,
  onPress,
}: {
  accessibilityLabel: string;
  label: string;
  meta: string | null;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.listAction,
        {
          backgroundColor: pressed ? colors.bgPressed : colors.bgPanel,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.grow}>
        <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{label}</Text>
        {meta ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{meta}</Text> : null}
      </View>
      <ChevronRight color={colors.textMuted} size={18} />
    </Pressable>
  );
}

function PrimaryAction({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel="Run comparison"
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: colors.accent, opacity: disabled ? 0.45 : 1 }]}
    >
      <Text style={{ color: colors.onAccent, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.secondary,
        {
          backgroundColor: colors.bgRaised,
          borderColor: colors.borderStrong,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {label === "Retry" ? <RotateCw color={colors.textPrimary} size={14} /> : null}
      <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function cellLabel(cell: ComparisonCell): string {
  return `${pathLabel(cell.path)} · ${providerLabel(cell.provider)}`;
}

function pathLabel(path: ComparisonCell["path"]): string {
  return path === "session" ? "Session" : "Orchestrator";
}

function providerLabel(provider: ComparisonCell["provider"]): string {
  if (provider === "codex") return "Codex";
  if (provider === "cursor") return "Cursor";
  return "Claude";
}

function modelLabel(provider: ComparisonCell["provider"]): string {
  if (provider === "codex") return "GPT-5.6 Sol";
  if (provider === "cursor") return "Grok 4.5";
  return "Opus 5";
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(status: string, colors: ReturnType<typeof useAppTheme>["colors"]): string {
  if (["passed", "saved", "completed"].includes(status)) return colors.statusGreen;
  if (["failed", "blocked", "error", "cancelled", "canceled"].includes(status))
    return colors.statusRed;
  if (["live", "active"].includes(status)) return colors.accent;
  return colors.statusAmber;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const styles = StyleSheet.create({
  cached: { fontSize: 13, fontWeight: "700" },
  card: { borderRadius: radii.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  cardHeading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  content: { gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xxl },
  decision: { borderRadius: radii.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: spacing.sm },
  error: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  grow: { flex: 1 },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  heading: { flex: 1 },
  iconButton: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  listAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    padding: spacing.md,
  },
  message: { fontSize: 13, lineHeight: 18 },
  overview: { borderRadius: radii.lg, borderWidth: 1, gap: spacing.xs, padding: spacing.lg },
  overviewMeta: { fontSize: 13 },
  primary: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 48,
  },
  progress: { fontSize: 28, fontWeight: "800" },
  provenance: { fontSize: 12, lineHeight: 17 },
  ranking: { fontSize: 15, fontWeight: "800" },
  safeArea: { flex: 1 },
  secondary: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: 19, fontWeight: "800" },
  status: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  statusDot: { borderRadius: 5, height: 10, width: 10 },
  subtitle: { fontSize: 12, marginTop: 2 },
  title: { fontSize: 18, fontWeight: "800" },
});
