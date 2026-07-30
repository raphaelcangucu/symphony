import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  AssistantThread,
  GoalControlInput,
  IssueBlocker,
  IssueComment,
  IssueDispatchInput,
  IssueMutationInput,
  IssueSummary,
  PullRequest,
} from "@/api/contracts";
import { StateView } from "@/components/StateView";
import type { EvidenceArtifact, EvidenceRecord } from "@/features/evidence/evidence-contract";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import { IssueCommentsTab } from "./IssueCommentsTab";
import { IssueEvidenceTab } from "./IssueEvidenceTab";
import { IssuePullRequestTab } from "./IssuePullRequestTab";
import { IssueSessionsTab } from "./IssueSessionsTab";
import { IssueSummaryTab } from "./IssueSummaryTab";
import { ISSUE_TABS, type IssueTabId } from "./issue-tabs";

type IssueScreenProps = {
  issue: IssueSummary | null;
  comments: IssueComment[];
  blockers: IssueBlocker[];
  subtasks: IssueSummary[];
  evidenceCount: number;
  evidenceError?: string | null;
  evidenceLoading?: boolean;
  evidenceRecords?: EvidenceRecord[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  dispatching: boolean;
  pullRequestError?: string | null;
  pullRequests?: PullRequest[];
  threads?: AssistantThread[];
  onBack(): void;
  onAddComment(body: string): void;
  onDispatch(action: IssueDispatchInput["action"]): void;
  onGoalAction(action: GoalControlInput["action"]): void;
  onCreateSubtask(title: string): void;
  onCreateSession(): void;
  onOpenDiff(): void;
  onOpenEvidence(): void;
  onOpenEvidenceArtifact(artifact: EvidenceArtifact, record: EvidenceRecord): void;
  onOpenFiles(): void;
  onOpenPreview(): void;
  onOpenPullRequest(): void;
  onOpenRelatedTask(identifier: string): void;
  onOpenSession(thread?: AssistantThread): void;
  onOpenTerminal(): void;
  onRefresh(): void;
  onSave(input: IssueMutationInput): void;
};

export function IssueScreen({
  issue,
  comments,
  blockers,
  subtasks = [],
  evidenceCount,
  evidenceError = null,
  evidenceLoading = false,
  evidenceRecords = [],
  loading,
  error,
  dispatching,
  pullRequestError = null,
  pullRequests = [],
  threads = [],
  onBack,
  onAddComment,
  onDispatch,
  onGoalAction,
  onCreateSubtask,
  onCreateSession,
  onOpenDiff,
  onOpenEvidence,
  onOpenEvidenceArtifact,
  onOpenFiles,
  onOpenPreview,
  onOpenPullRequest,
  onOpenRelatedTask,
  onOpenSession,
  onOpenTerminal,
  onRefresh,
}: IssueScreenProps) {
  const { colors } = useAppTheme();
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [activeTab, setActiveTab] = useState<IssueTabId>("summary");
  const [actionsOpen, setActionsOpen] = useState(false);

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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? colors.bgPressed : colors.bgPanel },
          ]}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.identifier, { color: colors.textPrimary }]}>
            {issue.displayIdentifier}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: colors.statusGreen }]} />
            <Text numberOfLines={1} style={[styles.status, { color: colors.textSecondary }]}>
              {issue.status}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="More task actions"
          accessibilityRole="button"
          onPress={() => setActionsOpen(true)}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? colors.bgPressed : colors.bgPanel },
          ]}
        >
          <Text style={[styles.more, { color: colors.textPrimary }]}>•••</Text>
        </Pressable>
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.borderSubtle }]}>
        {ISSUE_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, { borderBottomColor: selected ? colors.accent : "transparent" }]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  {
                    color: selected ? colors.textPrimary : colors.textMuted,
                    fontWeight: selected ? "700" : "500",
                  },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "summary" ? (
        <IssueSummaryTab
          blockers={blockers}
          comments={comments}
          evidenceCount={evidenceCount}
          issue={issue}
          latestEvidence={evidenceRecords[0] ?? null}
          onCreateSubtask={() => {
            const title = subtaskTitle.trim();
            if (!title) return;
            onCreateSubtask(title);
            setSubtaskTitle("");
          }}
          onOpenEvidence={onOpenEvidence}
          onOpenRelatedTask={onOpenRelatedTask}
          onOpenSession={() => onOpenSession()}
          onOpenWorkspace={onOpenFiles}
          onSubtaskTitleChange={setSubtaskTitle}
          pullRequests={pullRequests}
          subtasks={subtasks}
          subtaskTitle={subtaskTitle}
        />
      ) : activeTab === "pr" ? (
        <IssuePullRequestTab
          error={pullRequestError}
          loading={false}
          onOpen={() => onOpenPullRequest()}
          onRefresh={onRefresh}
          pullRequests={pullRequests}
        />
      ) : activeTab === "comments" ? (
        <IssueCommentsTab comments={comments} onAddComment={onAddComment} />
      ) : activeTab === "evidence" ? (
        <IssueEvidenceTab
          error={evidenceError}
          loading={evidenceLoading}
          onOpen={onOpenEvidence}
          onOpenArtifact={onOpenEvidenceArtifact}
          records={evidenceRecords}
        />
      ) : (
        <IssueSessionsTab
          loading={loading}
          onCreate={onCreateSession}
          onOpen={onOpenSession}
          threads={threads}
        />
      )}

      <Modal
        animationType="slide"
        onRequestClose={() => setActionsOpen(false)}
        transparent
        visible={actionsOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Close task actions"
            onPress={() => setActionsOpen(false)}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Task actions</Text>
            <Text style={{ color: colors.textMuted }}>Agent controls and workspace tools</Text>
            <View style={styles.sheetGrid}>
              <SheetAction
                disabled={dispatching}
                label="Continue agent"
                onPress={() => onDispatch("continue_work")}
              />
              <SheetAction
                disabled={dispatching}
                label="Stop agent"
                onPress={() => onDispatch("stop")}
              />
              <SheetAction label="Pause goal" onPress={() => onGoalAction("pause")} />
              <SheetAction label="Resume goal" onPress={() => onGoalAction("resume")} />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
            <View style={styles.sheetGrid}>
              <SheetAction label="Terminal" onPress={onOpenTerminal} />
              <SheetAction label="Preview" onPress={onOpenPreview} />
              <SheetAction label="Files" onPress={onOpenFiles} />
              <SheetAction label="Diff" onPress={onOpenDiff} />
              <SheetAction label="Pull request" onPress={onOpenPullRequest} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActionsOpen(false)}
              style={[styles.done, { backgroundColor: colors.textPrimary }]}
            >
              <Text style={{ color: colors.bgBase, fontWeight: "700" }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SheetAction({
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
        styles.sheetAction,
        {
          backgroundColor: colors.bgPanel,
          borderColor: colors.borderSubtle,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: colors.textPrimary }}>{label}</Text>
      <Text style={{ color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  back: { fontSize: 34, lineHeight: 35, marginTop: -3 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  done: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 48,
  },
  handle: {
    alignSelf: "center",
    borderRadius: radii.pill,
    height: 4,
    marginBottom: spacing.xs,
    width: 38,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 66,
    paddingHorizontal: spacing.sm,
  },
  headerText: { alignItems: "center", flex: 1, gap: 3 },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  identifier: { fontSize: 17, fontWeight: "800" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  more: { fontSize: 17, fontWeight: "800", letterSpacing: 1 },
  safeArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetAction: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  sheetGrid: { gap: spacing.xs },
  sheetTitle: { fontSize: 20, fontWeight: "800" },
  status: { fontSize: 12 },
  statusDot: { borderRadius: radii.pill, height: 7, width: 7 },
  statusRow: { alignItems: "center", flexDirection: "row", gap: 6, maxWidth: "90%" },
  tab: {
    alignItems: "center",
    borderBottomWidth: 2,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 2,
  },
  tabLabel: { fontSize: 11 },
  tabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
  },
});
