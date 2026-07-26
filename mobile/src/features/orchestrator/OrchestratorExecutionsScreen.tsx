import { ArrowLeft, ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { OrchestratorExecution } from "./orchestrator-executions";

type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export function OrchestratorExecutionsScreen({
  connectionState,
  error,
  executions,
  onBack,
  onOpen,
  onRetry,
}: {
  connectionState: ConnectionState;
  error: string | null;
  executions: OrchestratorExecution[];
  onBack(): void;
  onOpen(execution: OrchestratorExecution): void;
  onRetry(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.iconButton}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Orchestrator runs</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Live sessions on this Symphony host
          </Text>
        </View>
        <ConnectionBadge
          state={connectionState === "reconnecting" ? "connecting" : connectionState}
        />
      </View>

      {error ? (
        <View style={[styles.errorCard, { borderColor: colors.statusRed }]}>
          <Text style={{ color: colors.statusRed }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={[styles.retry, { color: colors.accent }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.list}>
        {executions.length === 0 && connectionState === "live" ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
              No orchestrator runs
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              Runs started by Symphony will appear here in real time.
            </Text>
          </View>
        ) : null}
        {executions.map((execution) => (
          <ExecutionRow execution={execution} key={execution.executionSessionId} onOpen={onOpen} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ExecutionRow({
  execution,
  onOpen,
}: {
  execution: OrchestratorExecution;
  onOpen(execution: OrchestratorExecution): void;
}) {
  const { colors } = useAppTheme();
  const agent = agentLabel(execution.agentKind);
  return (
    <Pressable
      accessibilityLabel={`Open ${execution.issueIdentifier} ${agent} execution`}
      accessibilityRole="button"
      onPress={() => onOpen(execution)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.bgPressed : colors.bgPanel,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <View
        style={[styles.statusDot, { backgroundColor: statusColor(execution.status, colors) }]}
      />
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.identifier, { color: colors.textPrimary }]}>
            {execution.issueIdentifier}
          </Text>
          <Text style={[styles.status, { color: colors.textMuted }]}>
            {statusLabel(execution.status)}
          </Text>
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {agent} · {execution.model ?? "Default model"}
        </Text>
        {execution.lastMessage ? (
          <Text numberOfLines={2} style={[styles.lastMessage, { color: colors.textMuted }]}>
            {execution.lastMessage}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={colors.textMuted} size={18} />
    </Pressable>
  );
}

function agentLabel(agent: OrchestratorExecution["agentKind"]): string {
  if (agent === "codex") return "Codex";
  if (agent === "claude") return "Claude";
  if (agent === "cursor") return "Cursor";
  if (agent === "opencode") return "OpenCode";
  return "Agent";
}

function statusLabel(status: OrchestratorExecution["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(
  status: OrchestratorExecution["status"],
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  if (status === "live") return colors.statusGreen;
  if (status === "waiting" || status === "retrying" || status === "paused")
    return colors.statusAmber;
  if (status === "error" || status === "aborted") return colors.statusRed;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: spacing.xs, paddingVertical: 72 },
  emptyBody: { fontSize: 14, lineHeight: 20, maxWidth: 280, textAlign: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  errorCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    margin: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  heading: { flex: 1 },
  iconButton: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  identifier: { flex: 1, fontSize: 16, fontWeight: "700" },
  lastMessage: { fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  list: { gap: spacing.xs, padding: spacing.md, paddingBottom: spacing.xxl },
  meta: { fontSize: 13, marginTop: 3 },
  retry: { fontWeight: "700" },
  row: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 92,
    padding: spacing.md,
  },
  rowMain: { flex: 1 },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  safeArea: { flex: 1 },
  status: { fontSize: 12, fontWeight: "700" },
  statusDot: { borderRadius: 5, height: 10, width: 10 },
  subtitle: { fontSize: 12, marginTop: 2 },
  title: { fontSize: 18, fontWeight: "700" },
});
