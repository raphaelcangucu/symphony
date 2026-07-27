import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AgentKind, CreateIssueInput, ProjectSummary } from "@/api/contracts";
import { COMPARISON_CELLS } from "@/features/comparisons/comparison-contract";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type CreateTaskScreenProps = {
  projects: ProjectSummary[];
  projectSlug: string | null;
  statuses: string[];
  initialAgent: AgentKind;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onBack(): void;
  onProjectChange(projectSlug: string): void;
  onSubmit(input: CreateTaskSubmission): void;
};

export type CreateTaskSubmission = CreateIssueInput & {
  taskKind: "standard" | "comparison";
};

export function CreateTaskScreen({
  projects,
  projectSlug,
  statuses,
  initialAgent,
  loading,
  submitting,
  error,
  onBack,
  onProjectChange,
  onSubmit,
}: CreateTaskScreenProps) {
  const { colors } = useAppTheme();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState(statuses[0] ?? "");
  const [taskKind, setTaskKind] = useState<CreateTaskSubmission["taskKind"]>("standard");

  useEffect(() => {
    if (!statuses.includes(status)) setStatus(statuses[0] ?? "");
  }, [status, statuses]);

  const valid = Boolean(projectSlug && title.trim() && status);
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.action}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
          New task
        </Text>
        <View style={styles.action} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Text style={{ color: colors.statusRed }}>{error}</Text> : null}
        <Text style={[styles.label, { color: colors.textMuted }]}>Task type</Text>
        <View style={styles.chips}>
          <Choice
            accessibilityLabel="Standard task"
            label="Standard task"
            onPress={() => setTaskKind("standard")}
            selected={taskKind === "standard"}
          />
          <Choice
            accessibilityLabel="Dev10x comparison"
            label="Dev10x comparison"
            onPress={() => setTaskKind("comparison")}
            selected={taskKind === "comparison"}
          />
        </View>
        {taskKind === "comparison" ? (
          <View
            style={[
              styles.matrix,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <Text style={[styles.matrixTitle, { color: colors.textPrimary }]}>
              Official high matrix
            </Text>
            {COMPARISON_CELLS.map((cell) => (
              <Text key={cell.id} style={[styles.matrixRow, { color: colors.textSecondary }]}>
                {comparisonCellLabel(cell)}
              </Text>
            ))}
            <Text style={[styles.matrixHint, { color: colors.textMuted }]}>
              This creates one parent task. The six real runs start only after your explicit
              dispatch.
            </Text>
          </View>
        ) : null}
        <Text style={[styles.label, { color: colors.textMuted }]}>Project</Text>
        <View style={styles.chips}>
          {projects.map((project) => (
            <Choice
              key={project.slug}
              label={project.name}
              onPress={() => onProjectChange(project.slug)}
              selected={project.slug === projectSlug}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel="Task title"
          onChangeText={setTitle}
          placeholder="What needs to be done?"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
          value={title}
        />
        <TextInput
          accessibilityLabel="Task description"
          multiline
          onChangeText={setDescription}
          placeholder="Description"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            styles.multiline,
            { borderColor: colors.borderSubtle, color: colors.textPrimary },
          ]}
          value={description}
        />
        <Text style={[styles.label, { color: colors.textMuted }]}>Status</Text>
        <View style={styles.chips}>
          {statuses.map((item) => (
            <Choice
              accessibilityLabel={`Select status ${item}`}
              key={item}
              label={item}
              onPress={() => setStatus(item)}
              selected={status === item}
            />
          ))}
        </View>
        {taskKind === "standard" ? (
          <TextInput
            accessibilityLabel="Agent goal"
            multiline
            onChangeText={setGoal}
            placeholder="Optional agent goal"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
            value={goal}
          />
        ) : null}
        <Pressable
          accessibilityLabel={taskKind === "comparison" ? "Create comparison task" : "Create task"}
          accessibilityRole="button"
          disabled={!valid || submitting || loading}
          onPress={() =>
            onSubmit({
              taskKind,
              title: title.trim(),
              description: description.trim() || null,
              status,
              agent: initialAgent,
              goal: taskKind === "standard" ? goal.trim() || null : null,
            })
          }
          style={[
            styles.submit,
            {
              backgroundColor: colors.textPrimary,
              opacity: !valid || submitting || loading ? 0.4 : 1,
            },
          ]}
        >
          <Text style={{ color: colors.bgBase, fontWeight: "700" }}>
            {submitting
              ? "Creating…"
              : taskKind === "comparison"
                ? "Create comparison task"
                : "Create task"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function comparisonCellLabel(cell: (typeof COMPARISON_CELLS)[number]): string {
  const path = cell.path === "session" ? "Session" : "Orchestrator";
  const model =
    cell.provider === "codex" ? "GPT-5.6 Sol" : cell.provider === "cursor" ? "Grok 4.5" : "Opus 5";
  return `${path} · ${model} · High`;
}

function Choice({
  accessibilityLabel,
  label,
  onPress,
  selected,
}: {
  accessibilityLabel?: string;
  label: string;
  onPress(): void;
  selected: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? colors.accentSoft : colors.bgPanel,
          borderColor: selected ? colors.accent : colors.borderSubtle,
        },
      ]}
    >
      <Text style={{ color: selected ? colors.accent : colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  back: { fontSize: 34, lineHeight: 36 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  choice: {
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  heading: { fontSize: 20, fontWeight: "700" },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 48,
    padding: spacing.md,
  },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  matrix: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  matrixHint: { fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  matrixRow: { fontSize: 14, lineHeight: 20 },
  matrixTitle: { fontSize: 16, fontWeight: "700", marginBottom: spacing.xs },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  safeArea: { flex: 1 },
  submit: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
  },
});
