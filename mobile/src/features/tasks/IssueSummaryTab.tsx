import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ReactNode } from "react";

import type {
  AssistantThread,
  IssueBlocker,
  IssueComment,
  IssueSummary,
  PullRequest,
} from "@/api/contracts";
import type { EvidenceRecord } from "@/features/evidence/evidence-contract";
import { radii, spacing, type ThemeColors } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type IssueSummaryTabProps = {
  blockers: IssueBlocker[];
  comments: IssueComment[];
  dispatching: boolean;
  evidenceCount: number;
  issue: IssueSummary;
  activeExecution?: AssistantThread | null;
  latestEvidence?: EvidenceRecord | null;
  pullRequests: PullRequest[];
  subtasks: IssueSummary[];
  subtaskTitle: string;
  onCreateSubtask(): void;
  onOpenEvidence(): void;
  onOpenExecution(thread: AssistantThread): void;
  onOpenRelatedTask(identifier: string): void;
  onOpenSession(): void;
  onRunOrchestration(): void;
  onOpenWorkspace(): void;
  onSubtaskTitleChange(value: string): void;
};

export function IssueSummaryTab({
  blockers,
  comments,
  dispatching,
  evidenceCount,
  issue,
  activeExecution = null,
  latestEvidence = null,
  pullRequests,
  subtasks,
  subtaskTitle,
  onCreateSubtask,
  onOpenEvidence,
  onOpenExecution,
  onOpenRelatedTask,
  onOpenSession,
  onRunOrchestration,
  onOpenWorkspace,
  onSubtaskTitleChange,
}: IssueSummaryTabProps) {
  const { colors } = useAppTheme();
  const workpad = [...comments]
    .reverse()
    .find((item) => item.kind === "workpad");
  const progress = workpadProgress(workpad?.body ?? "");
  const workpadCopy = workpadSummary(workpad?.body ?? "");
  const taskBrief = taskBriefFrom(issue.agentGoal ?? issue.description ?? "");
  const hasEvidence = evidenceCount > 0;
  const provenance = latestEvidence?.provenance;
  const provider = issue.agentKind ?? provenance?.agentKind ?? "Manual";
  const model =
    issue.model ?? provenance?.resolvedModel ?? provenance?.requestedModel;
  const effort =
    issue.effort ?? provenance?.resolvedEffort ?? provenance?.requestedEffort;
  const executionLabel = [model, effort].filter(Boolean).join(" · ");
  const isOrchestrator = issue.executionPath === "orchestrator";

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.srOnly}>Task summary</Text>

      <View style={styles.hero}>
        <View style={styles.pills}>
          <Pill
            color={colors.statusGreen}
            label={issue.status || "No status"}
          />
          {issue.priority !== null ? (
            <Pill
              color={priorityColor(colors, issue.priority)}
              label={priorityLabel(issue.priority)}
            />
          ) : null}
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {issue.title}
        </Text>
        {taskBrief ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {taskBrief}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.executionSnapshot,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <View style={styles.cardHeading}>
          <View style={styles.grow}>
            <Eyebrow colors={colors}>Execution snapshot</Eyebrow>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              What is ready to review
            </Text>
          </View>
          <View
            style={[
              styles.reviewPill,
              {
                backgroundColor: `${hasEvidence ? colors.statusGreen : colors.statusAmber}20`,
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: hasEvidence
                    ? colors.statusGreen
                    : colors.statusAmber,
                },
              ]}
            />
            <Text
              style={{
                color: hasEvidence ? colors.statusGreen : colors.statusAmber,
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              {hasEvidence ? "Review ready" : "Evidence pending"}
            </Text>
          </View>
        </View>
        <View style={styles.snapshotGrid}>
          <SnapshotItem colors={colors} label="Provider" value={provider} />
          <SnapshotItem
            colors={colors}
            label="Model"
            value={executionLabel || "Not selected"}
          />
          <SnapshotItem
            colors={colors}
            label="Run mode"
            value={isOrchestrator ? "Task orchestration" : "Direct session"}
          />
          {issue.targetRepository ? (
            <SnapshotItem
              colors={colors}
              label="Repository"
              value={issue.targetRepository}
            />
          ) : null}
          <SnapshotItem
            colors={colors}
            label="Evidence"
            value={
              hasEvidence
                ? `${evidenceCount} run${evidenceCount === 1 ? "" : "s"} available`
                : "Not published yet"
            }
          />
        </View>
      </View>

      <View style={styles.primaryActions}>
        <PrimaryAction
          disabled={dispatching}
          label={
            isOrchestrator && dispatching
              ? "Starting execution…"
              : isOrchestrator && activeExecution
                ? "Open execution"
                : isOrchestrator
                  ? "Run orchestration"
                  : "Open session"
          }
          onPress={
            isOrchestrator
              ? activeExecution
                ? () => onOpenExecution(activeExecution)
                : onRunOrchestration
              : onOpenSession
          }
        />
        <SecondaryAction label="Review evidence" onPress={onOpenEvidence} />
      </View>
      <Pressable
        accessibilityLabel="Open workspace"
        accessibilityRole="button"
        onPress={onOpenWorkspace}
        style={({ pressed }) => [
          styles.workspaceAction,
          {
            backgroundColor: pressed ? colors.bgPressed : colors.bgPanel,
            borderColor: colors.borderSubtle,
          },
        ]}
      >
        <Text style={{ color: colors.textSecondary, fontWeight: "700" }}>
          Open workspace
        </Text>
        <Text style={{ color: colors.textMuted }}>
          Browse files, diff and terminal ›
        </Text>
      </Pressable>

      {workpad ? (
        <Card colors={colors}>
          <View style={styles.cardHeading}>
            <View style={styles.grow}>
              <Eyebrow colors={colors}>Workpad progress</Eyebrow>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {progress.total > 0
                  ? `${progress.complete} of ${progress.total} complete`
                  : "Work in progress"}
              </Text>
            </View>
            {progress.total > 0 ? (
              <Text style={{ color: colors.accent, fontWeight: "700" }}>
                {Math.round((progress.complete / progress.total) * 100)}%
              </Text>
            ) : null}
          </View>
          {progress.total > 0 ? (
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: colors.borderSubtle },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.accent,
                    width: `${(progress.complete / progress.total) * 100}%`,
                  },
                ]}
              />
            </View>
          ) : null}
          {workpadCopy ? (
            <Text
              numberOfLines={3}
              style={{ color: colors.textSecondary, lineHeight: 20 }}
            >
              {workpadCopy}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle colors={colors}>Task details</SectionTitle>
      <View style={styles.metadataGrid}>
        {issue.assignee ? (
          <Meta colors={colors} label="Assignee" value={issue.assignee} />
        ) : null}
        {issue.branchName ? (
          <Meta colors={colors} label="Branch" value={issue.branchName} />
        ) : null}
        {issue.labels.length > 0 ? (
          <Meta
            colors={colors}
            label="Labels"
            value={issue.labels.join(" · ")}
          />
        ) : null}
        {issue.updatedAt ? (
          <Meta
            colors={colors}
            label="Updated"
            value={formatDate(issue.updatedAt)}
          />
        ) : null}
      </View>

      {pullRequests.length > 0 ? (
        <>
          <SectionTitle colors={colors}>Development</SectionTitle>
          <Card colors={colors}>
            <Eyebrow colors={colors}>Linked pull request</Eyebrow>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              PR #{pullRequests[0]?.number} ·{" "}
              {pullRequests[0]?.title || "Untitled pull request"}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              {pullRequests[0]?.headRef || "head"} →{" "}
              {pullRequests[0]?.baseRef || "base"}
            </Text>
          </Card>
        </>
      ) : null}

      <View style={styles.sectionHeading}>
        <SectionTitle colors={colors}>Evidence</SectionTitle>
        <Pressable accessibilityRole="button" onPress={onOpenEvidence}>
          <Text style={{ color: colors.accent }}>Open evidence</Text>
        </Pressable>
      </View>
      <Card colors={colors}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
          {evidenceCount === 1
            ? "1 durable run"
            : `${evidenceCount} durable runs`}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          Screenshots, recordings and validation results linked to this task.
        </Text>
      </Card>

      {blockers.length > 0 || subtasks.length > 0 ? (
        <>
          <SectionTitle colors={colors}>Related tasks</SectionTitle>
          {blockers.map((blocker) => (
            <RelatedTask
              accessibilityLabel={`Open blocker ${blocker.identifier}`}
              colors={colors}
              identifier={blocker.identifier}
              key={blocker.identifier}
              onPress={() => onOpenRelatedTask(blocker.identifier)}
              status={blocker.status}
              title={blocker.title}
            />
          ))}
          {subtasks.map((subtask) => (
            <RelatedTask
              accessibilityLabel={`Open subtask ${subtask.identifier}`}
              colors={colors}
              identifier={subtask.identifier}
              key={subtask.id}
              onPress={() => onOpenRelatedTask(subtask.identifier)}
              status={subtask.status}
              title={subtask.title}
            />
          ))}
        </>
      ) : null}

      <View style={styles.addSubtask}>
        <TextInput
          accessibilityLabel="New subtask title"
          onChangeText={onSubtaskTitleChange}
          placeholder="Add a subtask"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.subtaskInput,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderSubtle,
              color: colors.textPrimary,
            },
          ]}
          value={subtaskTitle}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!subtaskTitle.trim()}
          onPress={onCreateSubtask}
          style={({ pressed }) => [
            styles.addButton,
            {
              backgroundColor: colors.bgRaised,
              borderColor: colors.borderStrong,
              opacity: !subtaskTitle.trim() ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={{ color: colors.textPrimary }}>Create subtask</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Card({
  children,
  colors,
}: {
  children: ReactNode;
  colors: ThemeColors;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
      ]}
    >
      {children}
    </View>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}20` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function Meta({
  colors,
  label,
  value,
}: {
  colors: ThemeColors;
  label: string;
  value: string;
}) {
  return (
    <View
      style={[
        styles.meta,
        { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
      ]}
    >
      <Eyebrow colors={colors}>{label}</Eyebrow>
      <Text
        numberOfLines={2}
        style={{ color: colors.textPrimary, lineHeight: 19 }}
      >
        {value}
      </Text>
    </View>
  );
}

function SnapshotItem({
  colors,
  label,
  value,
}: {
  colors: ThemeColors;
  label: string;
  value: string;
}) {
  return (
    <View
      style={[
        styles.snapshotItem,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Eyebrow colors={colors}>{label}</Eyebrow>
      <Text
        numberOfLines={2}
        style={{
          color: colors.textPrimary,
          fontSize: 13,
          fontWeight: "700",
          lineHeight: 18,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function Eyebrow({
  children,
  colors,
}: {
  children: string;
  colors: ThemeColors;
}) {
  return (
    <Text style={[styles.eyebrow, { color: colors.textMuted }]}>
      {children}
    </Text>
  );
}

function SectionTitle({
  children,
  colors,
}: {
  children: string;
  colors: ThemeColors;
}) {
  return (
    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
      {children}
    </Text>
  );
}

function PrimaryAction({
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
        styles.primaryAction,
        {
          backgroundColor: colors.textPrimary,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ color: colors.bgBase, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color: colors.bgBase }}>›</Text>
    </Pressable>
  );
}

function SecondaryAction({
  label,
  onPress,
}: {
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryAction,
        {
          backgroundColor: colors.bgPanel,
          borderColor: colors.borderStrong,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RelatedTask({
  accessibilityLabel,
  colors,
  identifier,
  onPress,
  status,
  title,
}: {
  accessibilityLabel: string;
  colors: ThemeColors;
  identifier: string;
  onPress(): void;
  status: string | null;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.relatedTask, { backgroundColor: colors.bgPanel }]}
    >
      <View style={styles.grow}>
        <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>
          {identifier}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary }}>
          {title}
        </Text>
      </View>
      {status ? (
        <Text style={{ color: colors.textMuted }}>{status}</Text>
      ) : null}
      <Text style={{ color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}

function workpadProgress(body: string): { complete: number; total: number } {
  const tasks = body.match(/^\s*-\s+\[[ xX]\]/gm) ?? [];
  const complete = tasks.filter((task) => /\[[xX]\]/.test(task)).length;
  return { complete, total: tasks.length };
}

function workpadSummary(body: string): string {
  return body
    .split("\n")
    .filter(
      (line) =>
        !/^#{1,6}\s/.test(line.trim()) && !/^\s*-\s+\[[ xX]\]/.test(line),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function taskBriefFrom(body: string): string {
  const candidate = body.split("\n").find((line) => {
    const value = line.trim();
    return (
      value.length > 0 && !/^#{1,6}\s/.test(value) && !/^[-*]\s/.test(value)
    );
  });

  return (candidate ?? "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

function priorityLabel(
  priority: NonNullable<IssueSummary["priority"]>,
): string {
  return (
    ["No priority", "Urgent", "High", "Medium", "Low"][priority] ??
    String(priority)
  );
}

function priorityColor(colors: ThemeColors, priority: number): string {
  if (priority === 1) return colors.statusRed;
  if (priority === 2) return colors.statusAmber;
  return colors.textMuted;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}`;
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  addSubtask: { flexDirection: "row", gap: spacing.xs },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  description: { fontSize: 15, lineHeight: 22 },
  dot: { borderRadius: radii.pill, height: 7, width: 7 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  grow: { flex: 1 },
  hero: { gap: spacing.sm, paddingVertical: spacing.xs },
  executionSnapshot: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  meta: {
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 76,
    padding: spacing.sm,
  },
  metadataGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  pill: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  primaryAction: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  primaryActions: { flexDirection: "row", gap: spacing.xs },
  progressFill: { borderRadius: radii.pill, height: 6 },
  progressTrack: { borderRadius: radii.pill, height: 6, overflow: "hidden" },
  reviewPill: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  relatedTask: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    padding: spacing.sm,
  },
  secondaryAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: spacing.xs },
  snapshotGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  snapshotItem: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: "30%",
    flexGrow: 1,
    gap: 4,
    minHeight: 70,
    padding: spacing.sm,
  },
  srOnly: { height: 1, opacity: 0, position: "absolute", width: 1 },
  subtaskInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  workspaceAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
});
