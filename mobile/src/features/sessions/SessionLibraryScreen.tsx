import {
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  SquarePen,
  SquareTerminal,
} from "lucide-react-native";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ConnectionState } from "@/components/ConnectionBadge";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { StateView } from "@/components/StateView";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";
import { RootMenu } from "@/features/navigation/RootMenu";

import type { SessionTreeGroup, SessionTreeRow, SessionTreeState } from "./session-tree";

type SessionLibraryScreenProps = {
  connectionName: string;
  connectionDetail: string;
  connectionState: ConnectionState;
  groups: SessionTreeGroup[];
  query: string;
  loading: boolean;
  error: string | null;
  onNewChat(): void;
  onOpenConnections(): void;
  onOpenDiagnostics(): void;
  onOpenNotifications(): void;
  onOpenSettings(): void;
  onOpenTasks(): void;
  onOpenSession(threadId: number): void;
  onQueryChange(query: string): void;
  onRefresh(): void;
  onToggleGroup(groupKey: string): void;
};

const statePresentation: Record<SessionTreeState, { label: string; tone: StatusTone } | null> = {
  attention: { label: "Needs attention", tone: "warning" },
  running: { label: "Running", tone: "success" },
  queued: { label: "Queued", tone: "accent" },
  idle: null,
};

export function SessionLibraryScreen({
  connectionName,
  connectionDetail,
  connectionState,
  groups,
  query,
  loading,
  error,
  onNewChat,
  onOpenConnections,
  onOpenDiagnostics,
  onOpenNotifications,
  onOpenSettings,
  onOpenTasks,
  onOpenSession,
  onQueryChange,
  onRefresh,
  onToggleGroup,
}: SessionLibraryScreenProps) {
  const { colors } = useAppTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: colors.bgBase }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Open main menu"
          accessibilityRole="button"
          onPress={() => setMenuOpen((open) => !open)}
          style={styles.headerBrand}
        >
          <SquareTerminal color={colors.textPrimary} size={22} strokeWidth={1.8} />
        </Pressable>

        <View style={styles.connection}>
          <Text style={[styles.connectionName, { color: colors.textPrimary }]}>
            {connectionName}
          </Text>
          <View style={styles.connectionMeta}>
            <Text style={[styles.connectionDetail, { color: colors.textMuted }]}>
              {connectionDetail}
            </Text>
            <ConnectionBadge state={connectionState} />
          </View>
        </View>

        <View style={styles.headerBrand} />
      </View>

      {menuOpen ? (
        <RootMenu
          onClose={() => setMenuOpen(false)}
          onOpenConnections={onOpenConnections}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenNotifications={onOpenNotifications}
          onOpenSettings={onOpenSettings}
          onOpenTasks={onOpenTasks}
        />
      ) : null}

      <Text style={[styles.heading, { color: colors.textPrimary }]}>Projects</Text>

      <View style={styles.content}>
        {loading && groups.length === 0 ? (
          <StateView kind="loading" title="Loading sessions" />
        ) : error && groups.length === 0 ? (
          <StateView
            actionLabel="Retry"
            description={error}
            kind="error"
            onAction={onRefresh}
            title="Could not load sessions"
          />
        ) : groups.length === 0 ? (
          <StateView
            description="Start a chat to create the first session."
            kind="empty"
            title={query ? "No matching sessions" : "No sessions yet"}
          />
        ) : (
          <SectionList
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            onRefresh={onRefresh}
            refreshing={loading}
            renderItem={({ item }) => <SessionRow item={item} onOpenSession={onOpenSession} />}
            renderSectionHeader={({ section }) => (
              <ProjectHeader group={section} onToggleGroup={onToggleGroup} />
            )}
            sections={groups.map((group) => ({
              ...group,
              data: group.sessions,
            }))}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        )}
      </View>

      <View
        style={[styles.dock, { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong }]}
        testID="session-library-dock"
      >
        <View
          style={[
            styles.search,
            { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
          ]}
        >
          <Search color={colors.textMuted} size={20} />
          <TextInput
            accessibilityLabel="Search chats"
            onChangeText={onQueryChange}
            placeholder="Search chats"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={[styles.searchInput, { color: colors.textPrimary }]}
            value={query}
          />
        </View>
        <Pressable
          accessibilityLabel="Start a new chat"
          accessibilityRole="button"
          onPress={onNewChat}
          style={({ pressed }) => [
            styles.chatButton,
            {
              backgroundColor: colors.textPrimary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <SquarePen color={colors.bgBase} size={20} />
          <Text style={[styles.chatLabel, { color: colors.bgBase }]}>Chat</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ProjectHeader({
  group,
  onToggleGroup,
}: {
  group: SessionTreeGroup;
  onToggleGroup(groupKey: string): void;
}) {
  const { colors } = useAppTheme();
  const action = group.collapsed ? "Expand" : "Collapse";

  return (
    <Pressable
      accessibilityLabel={`${action} ${group.title} project`}
      accessibilityRole="button"
      onPress={() => onToggleGroup(group.key)}
      style={({ pressed }) => [
        styles.projectHeader,
        { backgroundColor: colors.bgBase, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <Folder color={colors.textPrimary} size={21} strokeWidth={1.8} />
      <Text style={[styles.projectTitle, { color: colors.textPrimary }]}>{group.title}</Text>
      <Text style={[styles.projectCount, { color: colors.textMuted }]}>{group.count}</Text>
      {group.collapsed ? (
        <ChevronRight color={colors.textMuted} size={18} />
      ) : (
        <ChevronDown color={colors.textMuted} size={18} />
      )}
    </Pressable>
  );
}

function SessionRow({
  item,
  onOpenSession,
}: {
  item: SessionTreeRow;
  onOpenSession(threadId: number): void;
}) {
  const { colors } = useAppTheme();
  const presentation = statePresentation[item.state];
  const disabled = item.threadId === null;

  return (
    <Pressable
      accessibilityLabel={`Open session ${item.title}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        if (item.threadId !== null) onOpenSession(item.threadId);
      }}
      style={({ pressed }) => [
        styles.sessionRow,
        {
          borderBottomColor: colors.borderSubtle,
          opacity: disabled ? 0.45 : pressed ? 0.58 : 1,
        },
      ]}
    >
      <View style={styles.sessionText}>
        <Text numberOfLines={1} style={[styles.sessionTitle, { color: colors.textPrimary }]}>
          {item.title}
        </Text>
        {item.issueIdentifier ? (
          <Text style={[styles.sessionIssue, { color: colors.textMuted }]}>
            {item.issueIdentifier}
          </Text>
        ) : null}
      </View>
      {presentation ? (
        <View style={styles.sessionState}>
          <StatusDot tone={presentation.tone} />
          <Text style={[styles.sessionStateLabel, { color: colors.textSecondary }]}>
            {presentation.label}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chatButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  chatLabel: {
    fontSize: 16,
    fontWeight: "800",
  },
  connection: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  connectionDetail: {
    fontSize: 12,
    fontWeight: "600",
  },
  connectionMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  connectionName: {
    fontSize: 17,
    fontWeight: "800",
  },
  content: {
    flex: 1,
  },
  dock: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
    left: spacing.md,
    padding: spacing.xs,
    position: "absolute",
    right: spacing.md,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerBrand: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  heading: {
    fontSize: 22,
    fontWeight: "800",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.lg,
  },
  listContent: {
    paddingBottom: 92,
    paddingHorizontal: spacing.md,
  },
  projectCount: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: "auto",
  },
  projectHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 48,
    paddingVertical: spacing.xs,
  },
  projectTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  safeArea: {
    flex: 1,
  },
  search: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  sessionIssue: {
    fontSize: 12,
    fontWeight: "600",
  },
  sessionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingLeft: 29,
    paddingVertical: spacing.xs,
  },
  sessionState: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  sessionStateLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  sessionText: {
    flex: 1,
    gap: 2,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
});
