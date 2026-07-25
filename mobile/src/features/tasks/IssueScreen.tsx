import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  GoalControlInput,
  IssueBlocker,
  IssueComment,
  IssueDispatchInput,
  IssueMutationInput,
  IssueSummary,
} from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type IssueScreenProps = {
  issue: IssueSummary | null;
  comments: IssueComment[];
  blockers: IssueBlocker[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  dispatching: boolean;
  onBack(): void;
  onAddComment(body: string): void;
  onDispatch(action: IssueDispatchInput["action"]): void;
  onGoalAction(action: GoalControlInput["action"]): void;
  onOpenDiff(): void;
  onOpenFiles(): void;
  onOpenPreview(): void;
  onOpenPullRequest(): void;
  onOpenSession(): void;
  onOpenTerminal(): void;
  onRefresh(): void;
  onSave(input: IssueMutationInput): void;
};

export function IssueScreen({
  issue,
  comments,
  blockers,
  loading,
  error,
  saving,
  dispatching,
  onBack,
  onAddComment,
  onDispatch,
  onGoalAction,
  onOpenDiff,
  onOpenFiles,
  onOpenPreview,
  onOpenPullRequest,
  onOpenSession,
  onOpenTerminal,
  onRefresh,
  onSave,
}: IssueScreenProps) {
  const { colors } = useAppTheme();
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setTitle(issue?.title ?? "");
    setDescription(issue?.description ?? "");
  }, [issue?.description, issue?.title]);

  if (loading && !issue) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
        <StateView kind="loading" title="Loading task" />
      </SafeAreaView>
    );
  }
  if (!issue) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
        <StateView
          actionLabel="Retry"
          description={error ?? "Task is unavailable"}
          kind="error"
          onAction={onRefresh}
          title="Could not load task"
        />
      </SafeAreaView>
    );
  }

  const toolActions = [
    ["Terminal", onOpenTerminal],
    ["Preview", onOpenPreview],
    ["Files", onOpenFiles],
    ["Diff", onOpenDiff],
    ["Pull request", onOpenPullRequest],
  ] as const;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.iconButton}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.identifier, { color: colors.textMuted }]}>
            {issue.displayIdentifier}
          </Text>
          <Text style={[styles.status, { color: colors.statusGreen }]}>{issue.status}</Text>
        </View>
        <Pressable
          accessibilityLabel="Save task"
          accessibilityRole="button"
          disabled={saving}
          onPress={() => onSave({ title, description })}
          style={styles.saveButton}
        >
          <Text style={{ color: colors.accent }}>{saving ? "Saving" : "Save"}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Text style={{ color: colors.statusRed }}>{error}</Text> : null}
        <TextInput
          accessibilityLabel="Task title"
          multiline
          onChangeText={setTitle}
          style={[styles.title, { color: colors.textPrimary }]}
          value={title}
        />
        <TextInput
          accessibilityLabel="Task description"
          multiline
          onChangeText={setDescription}
          placeholder="Add a description"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.description,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderSubtle,
              color: colors.textSecondary,
            },
          ]}
          value={description}
        />

        <View style={styles.metadata}>
          {issue.assignee ? <Meta label="Assignee" value={issue.assignee} /> : null}
          {issue.branchName ? <Meta label="Branch" value={issue.branchName} /> : null}
          {issue.agentKind ? <Meta label="Agent" value={issue.agentKind} /> : null}
        </View>

        <SectionTitle>Agent</SectionTitle>
        {issue.agentGoal ? (
          <Text style={[styles.goal, { color: colors.textSecondary }]}>{issue.agentGoal}</Text>
        ) : null}
        <View style={styles.actions}>
          <Action
            disabled={dispatching}
            label="Continue agent"
            onPress={() => onDispatch("continue_work")}
          />
          <Action disabled={dispatching} label="Stop agent" onPress={() => onDispatch("stop")} />
          <Action label="Pause goal" onPress={() => onGoalAction("pause")} />
          <Action label="Resume goal" onPress={() => onGoalAction("resume")} />
          <Action label="Open session" onPress={onOpenSession} />
        </View>

        <SectionTitle>Workspace</SectionTitle>
        <View style={styles.tools}>
          {toolActions.map(([label, action]) => (
            <Action key={label} label={label} onPress={action} />
          ))}
        </View>

        {blockers.length > 0 ? (
          <>
            <SectionTitle>Blocked by</SectionTitle>
            {blockers.map((blocker) => (
              <Text key={blocker.identifier} style={{ color: colors.statusAmber }}>
                {blocker.identifier} {blocker.title}
              </Text>
            ))}
          </>
        ) : null}

        <SectionTitle>Comments</SectionTitle>
        {comments.map((item) => (
          <View
            key={item.id}
            style={[
              styles.comment,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <Text style={{ color: colors.textMuted }}>{item.author ?? "Unknown"}</Text>
            <Text style={{ color: colors.textPrimary }}>{item.body}</Text>
          </View>
        ))}
        <TextInput
          accessibilityLabel="New comment"
          multiline
          onChangeText={setComment}
          placeholder="Add a comment"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.commentInput,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderSubtle,
              color: colors.textPrimary,
            },
          ]}
          value={comment}
        />
        <Action
          disabled={!comment.trim()}
          label="Add comment"
          onPress={() => {
            const body = comment.trim();
            if (!body) return;
            onAddComment(body);
            setComment("");
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{children}</Text>;
}

function Meta({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View>
      <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={{ color: colors.textSecondary }}>{value}</Text>
    </View>
  );
}

function Action({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: colors.bgRaised,
          borderColor: colors.borderStrong,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: colors.textPrimary }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  back: { fontSize: 34, lineHeight: 36 },
  comment: { borderRadius: radii.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  commentInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 88,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  description: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 120,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  goal: { fontSize: 14, lineHeight: 20 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerText: { flex: 1 },
  iconButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  identifier: { fontSize: 13, fontWeight: "700" },
  metaLabel: { fontSize: 11, textTransform: "uppercase" },
  metadata: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  safeArea: { flex: 1 },
  saveButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 64 },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: spacing.sm },
  status: { fontSize: 12 },
  title: { fontSize: 24, fontWeight: "700", minHeight: 44 },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
