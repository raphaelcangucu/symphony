import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { IssueSummary } from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { TaskGroup } from "./task-filters";

type TasksScreenProps = {
  groups: TaskGroup[];
  query: string;
  loading: boolean;
  error: string | null;
  activeStatus: string | null;
  statuses: string[];
  onBack(): void;
  onCreateTask(): void;
  onOpenTask(projectSlug: string, identifier: string): void;
  onQueryChange(query: string): void;
  onRefresh(): void;
  onStatusChange(status: string | null): void;
};

export function TasksScreen({
  groups,
  query,
  loading,
  error,
  activeStatus,
  statuses,
  onBack,
  onCreateTask,
  onOpenTask,
  onQueryChange,
  onRefresh,
  onStatusChange,
}: TasksScreenProps) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerAction}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
          Tasks
        </Text>
        <Pressable
          accessibilityLabel="Create task"
          accessibilityRole="button"
          onPress={onCreateTask}
          style={styles.headerAction}
        >
          <Text style={[styles.create, { color: colors.accent }]}>＋</Text>
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel="Search tasks"
        onChangeText={onQueryChange}
        placeholder="Search tasks"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.search,
          {
            backgroundColor: colors.bgPanel,
            borderColor: colors.borderSubtle,
            color: colors.textPrimary,
          },
        ]}
        value={query}
      />

      <View style={styles.filters}>
        {statuses.map((status) => {
          const selected = activeStatus === status;
          return (
            <Pressable
              accessibilityLabel={`Filter by ${status}`}
              accessibilityRole="button"
              key={status}
              onPress={() => onStatusChange(selected ? null : status)}
              style={[
                styles.filter,
                {
                  backgroundColor: selected ? colors.accentSoft : colors.bgPanel,
                  borderColor: selected ? colors.accent : colors.borderSubtle,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.accent : colors.textSecondary }}>
                {status}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.content}>
        {loading && groups.length === 0 ? (
          <StateView kind="loading" title="Loading tasks" />
        ) : error && groups.length === 0 ? (
          <StateView
            actionLabel="Retry"
            description={error}
            kind="error"
            onAction={onRefresh}
            title="Could not load tasks"
          />
        ) : groups.length === 0 ? (
          <StateView kind="empty" title="No matching tasks" />
        ) : (
          <SectionList
            contentContainerStyle={styles.list}
            keyExtractor={(item) => `${item.projectSlug}:${item.identifier}`}
            onRefresh={onRefresh}
            refreshing={loading}
            renderItem={({ item }) => <TaskRow item={item} onOpenTask={onOpenTask} />}
            renderSectionHeader={({ section }) => (
              <View style={[styles.section, { backgroundColor: colors.bgBase }]}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  {section.status}
                </Text>
                <Text style={{ color: colors.textMuted }}>{section.tasks.length}</Text>
              </View>
            )}
            sections={groups.map((group) => ({ ...group, data: group.tasks }))}
            stickySectionHeadersEnabled={false}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function TaskRow({
  item,
  onOpenTask,
}: {
  item: IssueSummary;
  onOpenTask(projectSlug: string, identifier: string): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`Open task ${item.displayIdentifier}`}
      accessibilityRole="button"
      onPress={() => onOpenTask(item.projectSlug, item.identifier)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.bgPressed : colors.bgPanel,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text style={[styles.identifier, { color: colors.textMuted }]}>
          {item.displayIdentifier}
        </Text>
        {item.priority !== null ? (
          <Text style={[styles.priority, { color: colors.statusAmber }]}>P{item.priority}</Text>
        ) : null}
      </View>
      <Text style={[styles.taskTitle, { color: colors.textPrimary }]}>{item.title}</Text>
      <View style={styles.meta}>
        <Text style={{ color: colors.textMuted }}>{item.projectSlug}</Text>
        {item.assignee ? (
          <Text style={{ color: colors.textSecondary }}>{item.assignee}</Text>
        ) : null}
        {item.agentKind ? (
          <Text style={{ color: colors.statusPurple }}>{item.agentKind}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { fontSize: 34, lineHeight: 36 },
  content: { flex: 1 },
  create: { fontSize: 28 },
  filter: {
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    minHeight: 56,
  },
  headerAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  identifier: { fontSize: 12, fontWeight: "700" },
  list: { gap: spacing.xs, padding: spacing.md, paddingTop: 0 },
  meta: { flexDirection: "row", gap: spacing.sm },
  priority: { fontSize: 12, fontWeight: "700" },
  row: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  rowHeader: { flexDirection: "row", justifyContent: "space-between" },
  safeArea: { flex: 1 },
  search: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  section: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700" },
  taskTitle: { fontSize: 16, fontWeight: "600" },
  title: { fontSize: 20, fontWeight: "700" },
});
