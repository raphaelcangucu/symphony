import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AssistantThread } from "@/api/contracts";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export function IssueSessionsTab({
  loading,
  onCreate,
  onOpen,
  threads,
}: {
  loading: boolean;
  onCreate(): void;
  onOpen(thread: AssistantThread): void;
  threads: AssistantThread[];
}) {
  const { colors } = useAppTheme();
  const ordered = [...threads].sort((left, right) => {
    const leftExecution = left.scope === "issue_execution" ? 0 : 1;
    const rightExecution = right.scope === "issue_execution" ? 0 : 1;
    return leftExecution - rightExecution;
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Text style={{ color: colors.textMuted }}>
          {loading
            ? "Loading sessions"
            : `${threads.length} associated ${threads.length === 1 ? "session" : "sessions"}`}
        </Text>
        <Pressable
          accessibilityLabel="New task session"
          accessibilityRole="button"
          onPress={onCreate}
          style={[styles.create, { backgroundColor: colors.textPrimary }]}
        >
          <Text style={{ color: colors.bgBase }}>＋ New</Text>
        </Pressable>
      </View>
      {!loading && ordered.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          No sessions are associated with this task.
        </Text>
      ) : null}
      {ordered.map((thread) => (
        <Pressable
          accessibilityLabel={`Open session ${thread.id}`}
          accessibilityRole="button"
          key={thread.id}
          onPress={() => onOpen(thread)}
          style={[
            styles.row,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <View
            style={[
              styles.dot,
              {
                backgroundColor: thread.status === "active" ? colors.statusGreen : colors.textMuted,
              },
            ]}
          />
          <View style={styles.copy}>
            <View style={styles.labels}>
              <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                {thread.title || `Session ${thread.id}`}
              </Text>
              <Text style={{ color: colors.textMuted }}>
                {thread.scope === "issue_execution" ? "Execution" : "Chat"}
              </Text>
            </View>
            {thread.agentKind ? (
              <Text style={{ color: colors.textSecondary }}>{thread.agentKind}</Text>
            ) : null}
            {thread.preview ? (
              <Text numberOfLines={2} style={{ color: colors.textMuted }}>
                {thread.preview}
              </Text>
            ) : null}
          </View>
          <Text style={{ color: colors.textMuted }}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  copy: { flex: 1, gap: spacing.xs },
  create: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  dot: { borderRadius: radii.pill, height: 8, marginTop: spacing.xs, width: 8 },
  empty: { paddingVertical: spacing.xl, textAlign: "center" },
  labels: { flexDirection: "row", gap: spacing.xs },
  row: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 76,
    padding: spacing.md,
  },
  title: { flex: 1, fontWeight: "700" },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
