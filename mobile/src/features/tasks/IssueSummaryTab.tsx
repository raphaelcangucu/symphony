import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ReactNode } from "react";

import type { IssueBlocker, IssueComment, IssueSummary, PullRequest } from "@/api/contracts";
import { radii, spacing, type ThemeColors } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type IssueSummaryTabProps = {
  blockers: IssueBlocker[];
  comments: IssueComment[];
  evidenceCount: number;
  issue: IssueSummary;
  pullRequests: PullRequest[];
  subtasks: IssueSummary[];
  subtaskTitle: string;
  onCreateSubtask(): void;
  onOpenEvidence(): void;
  onOpenRelatedTask(identifier: string): void;
  onOpenSession(): void;
  onOpenWorkspace(): void;
  onSubtaskTitleChange(value: string): void;
};

export function IssueSummaryTab({
  blockers,
  comments,
  evidenceCount,
  issue,
  pullRequests,
  subtasks,
  subtaskTitle,
  onCreateSubtask,
  onOpenEvidence,
  onOpenRelatedTask,
  onOpenSession,
  onOpenWorkspace,
  onSubtaskTitleChange,
}: IssueSummaryTabProps) {
  const { colors } = useAppTheme();
  const workpad = [...comments].reverse().find((item) => item.kind === "workpad");
  const progress = workpadProgress(workpad?.body ?? "");
  const workpadCopy = workpadSummary(workpad?.body ?? "");

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.srOnly}>Task summary</Text>

      <View style={styles.hero}>
        <View style={styles.pills}>
          <Pill color={colors.statusGreen} label={issue.status || "No status"} />
          {issue.priority !== null ? (
            <Pill
              color={priorityColor(colors, issue.priority)}
              label={priorityLabel(issue.priority)}
            />
          ) : null}
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{issue.title}</Text>
        {issue.description ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {issue.description}
          </Text>
        ) : null}
      </View>

      <View style={styles.primaryActions}>
        <PrimaryAction label="Open session" onPress={onOpenSession} />
        <SecondaryAction label="Open workspace" onPress={onOpenWorkspace} />
      </View>

      {issue.agentGoal ? (
        <Card colors={colors}>
          <Eyebrow colors={colors}>Agent objective</Eyebrow>
          <Text style={[styles.goal, { color: colors.textPrimary }]}>{issue.agentGoal}</Text>
          <Text style={{ color: colors.textMuted }}>
            {[issue.agentKind, issue.model, issue.effort].filter(Boolean).join(" · ")}
          </Text>
        </Card>
      ) : null}

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
            <View style={[styles.progressTrack, { backgroundColor: colors.borderSubtle }]}>
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
            <Text numberOfLines={3} style={{ color: colors.textSecondary, lineHeight: 20 }}>
              {workpadCopy}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle colors={colors}>Task details</SectionTitle>
      <View style={styles.metadataGrid}>
        {issue.assignee ? <Meta colors={colors} label="Assignee" value={issue.assignee} /> : null}
        {issue.branchName ? <Meta colors={colors} label="Branch" value={issue.branchName} /> : null}
        {issue.labels.length > 0 ? (
          <Meta colors={colors} label="Labels" value={issue.labels.join(" · ")} />
        ) : null}
        {issue.updatedAt ? (
          <Meta colors={colors} label="Updated" value={formatDate(issue.updatedAt)} />
        ) : null}
      </View>

      {pullRequests.length > 0 ? (
        <>
          <SectionTitle colors={colors}>Development</SectionTitle>
          <Card colors={colors}>
            <Eyebrow colors={colors}>Linked pull request</Eyebrow>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              PR #{pullRequests[0]?.number} · {pullRequests[0]?.title || "Untitled pull request"}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              {pullRequests[0]?.headRef || "head"} → {pullRequests[0]?.baseRef || "base"}
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
          {evidenceCount === 1 ? "1 durable run" : `${evidenceCount} durable runs`}
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

function Card({ children, colors }: { children: ReactNode; colors: ThemeColors }) {
  return (
    <View
      style={[styles.card, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
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

function Meta({ colors, label, value }: { colors: ThemeColors; label: string; value: string }) {
  return (
    <View
      style={[styles.meta, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
    >
      <Eyebrow colors={colors}>{label}</Eyebrow>
      <Text numberOfLines={2} style={{ color: colors.textPrimary, lineHeight: 19 }}>
        {value}
      </Text>
    </View>
  );
}

function Eyebrow({ children, colors }: { children: string; colors: ThemeColors }) {
  return <Text style={[styles.eyebrow, { color: colors.textMuted }]}>{children}</Text>;
}

function SectionTitle({ children, colors }: { children: string; colors: ThemeColors }) {
  return <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{children}</Text>;
}

function PrimaryAction({ label, onPress }: { label: string; onPress(): void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        { backgroundColor: colors.textPrimary, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={{ color: colors.bgBase, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color: colors.bgBase }}>›</Text>
    </Pressable>
  );
}

function SecondaryAction({ label, onPress }: { label: string; onPress(): void }) {
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
      <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{label}</Text>
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
        <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{identifier}</Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary }}>
          {title}
        </Text>
      </View>
      {status ? <Text style={{ color: colors.textMuted }}>{status}</Text> : null}
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
    .filter((line) => !/^#{1,6}\s/.test(line.trim()) && !/^\s*-\s+\[[ xX]\]/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function priorityLabel(priority: NonNullable<IssueSummary["priority"]>): string {
  return ["No priority", "Urgent", "High", "Medium", "Low"][priority] ?? String(priority);
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
  card: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardHeading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
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
  goal: { fontSize: 16, lineHeight: 23 },
  grow: { flex: 1 },
  hero: { gap: spacing.sm, paddingVertical: spacing.xs },
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
  srOnly: { height: 1, opacity: 0, position: "absolute", width: 1 },
  subtaskInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5, lineHeight: 32 },
});
