import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  AgentKind,
  AssistantCatalog,
  CreateIssueInput,
  ProjectSummary,
} from "@/api/contracts";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type CreateTaskScreenProps = {
  projects: ProjectSummary[];
  projectSlug: string | null;
  statuses: string[];
  catalog?: AssistantCatalog | null;
  initialAgent: AgentKind;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onBack(): void;
  onProjectChange(projectSlug: string): void;
  onSubmit(input: CreateTaskSubmission): void;
};

export type CreateTaskSubmission = CreateIssueInput;

export function CreateTaskScreen({
  projects,
  projectSlug,
  statuses,
  catalog = null,
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
  const [agent, setAgent] = useState<AgentKind>(initialAgent);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);

  useEffect(() => {
    if (!statuses.includes(status)) setStatus(statuses[0] ?? "");
  }, [status, statuses]);
  useEffect(() => {
    if (!catalog?.agents.some((item) => item.agent === agent)) {
      setAgent(initialAgent);
      setModel(null);
      setEffort(null);
    }
  }, [agent, catalog, initialAgent]);

  const valid = Boolean(projectSlug && title.trim() && status);
  const selectedAgent = catalog?.agents.find((item) => item.agent === agent) ?? null;
  const selectedModel = selectedAgent?.models.find((item) => item.model === model) ?? null;
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
        {catalog ? (
          <>
            <Text style={[styles.label, { color: colors.textMuted }]}>Agent</Text>
            <View style={styles.chips}>
              {catalog.agents.map((item) => (
                <Choice
                  accessibilityLabel={`Select agent ${item.agentLabel}`}
                  key={item.agent}
                  label={item.agentLabel}
                  onPress={() => {
                    setAgent(item.agent);
                    setModel(null);
                    setEffort(null);
                  }}
                  selected={item.agent === agent}
                />
              ))}
            </View>
            <Text style={[styles.label, { color: colors.textMuted }]}>Model</Text>
            <View style={styles.chips}>
              {selectedAgent?.models.map((item) => (
                <Choice
                  accessibilityLabel={`Select model ${item.label}`}
                  key={item.model}
                  label={item.label}
                  onPress={() => {
                    setModel(item.model);
                    setEffort(item.efforts[0]?.effort ?? null);
                  }}
                  selected={item.model === model}
                />
              ))}
            </View>
            {selectedModel?.efforts.length ? (
              <>
                <Text style={[styles.label, { color: colors.textMuted }]}>Effort</Text>
                <View style={styles.chips}>
                  {selectedModel.efforts.map((item) => (
                    <Choice
                      accessibilityLabel={`Select effort ${item.label}`}
                      key={item.effort}
                      label={item.label}
                      onPress={() => setEffort(item.effort)}
                      selected={item.effort === effort}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
        <TextInput
          accessibilityLabel="Agent goal"
          multiline
          onChangeText={setGoal}
          placeholder="Optional agent goal"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { borderColor: colors.borderSubtle, color: colors.textPrimary }]}
          value={goal}
        />
        <Pressable
          accessibilityLabel="Create task"
          accessibilityRole="button"
          disabled={!valid || submitting || loading}
          onPress={() =>
            onSubmit({
              title: title.trim(),
              description: description.trim() || null,
              status,
              agent,
              model,
              effort,
              goal: goal.trim() || null,
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
            {submitting ? "Creating…" : "Create task"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
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
  multiline: { minHeight: 120, textAlignVertical: "top" },
  safeArea: { flex: 1 },
  submit: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
  },
});
