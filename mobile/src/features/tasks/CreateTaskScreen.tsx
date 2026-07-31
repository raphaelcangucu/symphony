import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  CircleDot,
  FolderGit2,
  Gauge,
  GitBranch,
  MessageSquare,
  PackageOpen,
  Plus,
  Sparkles,
  Workflow,
} from "lucide-react-native";

import type {
  AgentKind,
  AssistantCatalog,
  CreateIssueInput,
  ExecutionPath,
  ProjectSummary,
} from "@/api/contracts";
import {
  PickerModal,
  type PickerOption,
} from "@/dev10x/components/PickerModal";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type TaskPicker =
  "project" | "status" | "repository" | "agent" | "model" | "effort" | null;

type CreateTaskScreenProps = {
  projects: ProjectSummary[];
  projectSlug: string | null;
  projectContextLocked?: boolean;
  statuses: string[];
  catalog?: AssistantCatalog | null;
  repositories?: Array<{ githubFullName: string; workspacePath: string }>;
  initialAgent: AgentKind;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onBack(): void;
  onProjectChange(projectSlug: string): void;
  onSubmit(input: CreateTaskSubmission): void;
};

export type CreateTaskSubmission = {
  issue: CreateIssueInput;
  startSession: {
    prompt: string;
    workspacePath: string | null;
  } | null;
};

export function CreateTaskScreen({
  projects,
  projectSlug,
  projectContextLocked = false,
  statuses,
  catalog = null,
  repositories = [],
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
  const [executionPath, setExecutionPath] = useState<ExecutionPath>("session");
  const [targetRepository, setTargetRepository] = useState<string | null>(null);
  const [picker, setPicker] = useState<TaskPicker>(null);

  useEffect(() => {
    if (!statuses.includes(status)) setStatus(statuses[0] ?? "");
  }, [status, statuses]);
  useEffect(() => {
    // During a host reconnect React Query briefly exposes `null` while the
    // catalog is being restored. That is not an invalid selection: clearing
    // model/effort here makes the form jump back to the machine defaults as
    // soon as the user focuses a field. Only reconcile once a real catalog is
    // available.
    if (
      catalog &&
      !catalog.agents.some((item) => item.agent === agent)
    ) {
      setAgent(initialAgent);
      setModel(null);
      setEffort(null);
    }
  }, [agent, catalog, initialAgent]);
  useEffect(() => {
    if (
      targetRepository &&
      repositories.length > 0 &&
      !repositories.some((item) => item.githubFullName === targetRepository)
    ) {
      setTargetRepository(null);
    }
  }, [repositories, targetRepository]);

  const orchestrator = executionPath === "orchestrator";
  const needsRepositorySelection = repositories.length > 1;
  const selectedProject =
    projects.find((project) => project.slug === projectSlug) ?? null;
  const selectedAgent =
    catalog?.agents.find((item) => item.agent === agent) ?? null;
  const selectedModel =
    selectedAgent?.models.find((item) => item.model === model) ?? null;
  const selectedEffort =
    selectedModel?.efforts.find((item) => item.effort === effort) ?? null;
  const effectiveTargetRepository =
    targetRepository ??
    (repositories.length === 1 ? repositories[0].githubFullName : null);
  const selectedRepository = repositories.find(
    (item) => item.githubFullName === effectiveTargetRepository,
  );
  const valid = Boolean(
    projectSlug &&
    title.trim() &&
    status &&
    (!orchestrator ||
      (description.trim() &&
        agent &&
        model &&
        effort &&
        (!needsRepositorySelection || targetRepository))),
  );
  const pickerConfig = useMemo(
    () =>
      taskPickerConfig({
        picker,
        projects,
        statuses,
        repositories,
        catalog,
        selectedAgent,
        selectedModel,
        projectSlug,
        status,
        targetRepository,
        agent,
        model,
        effort,
      }),
    [
      agent,
      catalog,
      effort,
      model,
      picker,
      projectSlug,
      projects,
      repositories,
      selectedAgent,
      selectedModel,
      status,
      statuses,
      targetRepository,
    ],
  );

  function selectPickerValue(value: string) {
    switch (picker) {
      case "project":
        onProjectChange(value);
        break;
      case "status":
        setStatus(value);
        break;
      case "repository":
        setTargetRepository(value);
        break;
      case "agent":
        setAgent(value as AgentKind);
        setModel(null);
        setEffort(null);
        break;
      case "model": {
        const nextModel =
          selectedAgent?.models.find((item) => item.model === value) ?? null;
        setModel(value);
        setEffort(nextModel?.efforts[0]?.effort ?? null);
        break;
      }
      case "effort":
        setEffort(value);
        break;
    }
  }

  function submit() {
    const prompt = description.trim() || title.trim();
    onSubmit({
      issue: {
        title: title.trim(),
        description: description.trim() || null,
        status,
        agent,
        model,
        effort,
        executionPath,
        ...(effectiveTargetRepository
          ? { targetRepository: effectiveTargetRepository }
          : {}),
        goal: orchestrator ? null : goal.trim() || null,
      },
      startSession: orchestrator
        ? null
        : {
            prompt,
            workspacePath: null,
          },
    });
  }

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: colors.bgBase }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.safeArea}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.headerAction}
          >
            <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            style={[styles.heading, { color: colors.textPrimary }]}
          >
            Nova task
          </Text>
          <View style={styles.headerAction} />
        </View>

        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="create-task-scroll"
        >
          <View style={styles.intro}>
            <Text style={[styles.introCopy, { color: colors.textSecondary }]}>
              Comece pelo contexto do projeto. A execução pode ser ajustada
              depois.
            </Text>
          </View>

          {error ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.errorCard,
                {
                  backgroundColor: colors.bgPanel,
                  borderColor: colors.statusRed,
                },
              ]}
            >
              <Text style={{ color: colors.statusRed }}>{error}</Text>
            </View>
          ) : null}

          <View
            accessibilityLabel="Task execution type"
            style={[styles.segmented, { backgroundColor: colors.bgPanel }]}
          >
            <ExecutionChoice
              accessibilityLabel="Select session execution"
              icon={
                <MessageSquare
                  size={17}
                  color={
                    executionPath === "session"
                      ? colors.accent
                      : colors.textSecondary
                  }
                />
              }
              label="Com sessão"
              onPress={() => setExecutionPath("session")}
              selected={executionPath === "session"}
            />
            <ExecutionChoice
              accessibilityLabel="Select orchestrator execution"
              icon={
                <Workflow
                  size={17}
                  color={orchestrator ? colors.accent : colors.textSecondary}
                />
              }
              label="Orquestrador"
              onPress={() => setExecutionPath("orchestrator")}
              selected={orchestrator}
            />
          </View>

          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            {orchestrator
              ? "Cria somente a task. O Symphony a assume pelo contrato Todo, sem abrir um chat artificial."
              : "Cria a task e abre uma sessão vinculada para você orientar o agente pelo chat."}
          </Text>

          <View style={styles.contextList}>
            {!projectContextLocked ? (
              <SelectionRow
                accessibilityLabel="Select project"
                icon={<FolderGit2 size={18} color={colors.textSecondary} />}
                label={selectedProject?.name ?? "Selecionar projeto"}
                muted={!selectedProject}
                onPress={() => setPicker("project")}
              />
            ) : null}

            <SelectionRow
              accessibilityLabel="Select workspace"
              icon={<GitBranch size={18} color={colors.textSecondary} />}
              label="Workspace compartilhado"
              subtitle="Contexto multi-repo do projeto"
            />

            {orchestrator && repositories.length > 0 ? (
              <SelectionRow
                accessibilityLabel="Select target repository"
                icon={<PackageOpen size={18} color={colors.textSecondary} />}
                label={
                  selectedRepository?.githubFullName ??
                  (needsRepositorySelection
                    ? "Selecionar repositório alvo"
                    : repositories[0].githubFullName)
                }
                muted={needsRepositorySelection && !selectedRepository}
                onPress={() => setPicker("repository")}
              />
            ) : null}

            <SelectionRow
              accessibilityLabel="Select task status"
              icon={<CircleDot size={18} color={colors.textSecondary} />}
              label={status || "Selecionar status"}
              subtitle="Status inicial"
              onPress={() => setPicker("status")}
            />

            {catalog ? (
              <>
                <SelectionRow
                  accessibilityLabel="Select task agent"
                  icon={<Bot size={18} color={colors.textSecondary} />}
                  label={selectedAgent?.agentLabel ?? agent}
                  onPress={() => setPicker("agent")}
                />
                <SelectionRow
                  accessibilityLabel="Select task model"
                  icon={<Sparkles size={18} color={colors.textSecondary} />}
                  label={
                    selectedModel
                      ? selectedModel.label
                      : orchestrator
                        ? "Selecionar modelo"
                        : "Modelo padrão da máquina"
                  }
                  muted={!selectedModel}
                  onPress={() => setPicker("model")}
                />
                {selectedModel?.efforts.length ? (
                  <SelectionRow
                    accessibilityLabel="Select task effort"
                    icon={<Gauge size={18} color={colors.textSecondary} />}
                    label={selectedEffort?.label ?? "Selecionar esforço"}
                    muted={!selectedEffort}
                    onPress={() => setPicker("effort")}
                  />
                ) : null}
              </>
            ) : null}
          </View>

          <View style={styles.contract}>
            {orchestrator ? (
              <Workflow size={17} color={colors.textSecondary} />
            ) : (
              <MessageSquare size={17} color={colors.textSecondary} />
            )}
            <Text
              style={[styles.contractCopy, { color: colors.textSecondary }]}
            >
              {orchestrator
                ? "Agente, modelo, esforço e repositório alvo ficam persistidos na task. A execução aparecerá na aba Sessões."
                : "A task será criada e a sessão associada será aberta no workspace compartilhado."}
            </Text>
          </View>

          <View
            style={[
              styles.composer,
              {
                backgroundColor: colors.bgPanel,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <TextInput
              accessibilityLabel="Task title"
              onChangeText={setTitle}
              placeholder="O que precisa ser feito?"
              placeholderTextColor={colors.textMuted}
              style={[styles.titleInput, { color: colors.textPrimary }]}
              value={title}
            />
            <TextInput
              accessibilityLabel="Task description"
              multiline
              onChangeText={setDescription}
              placeholder="Descreva o resultado esperado, critérios e evidências…"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.descriptionInput,
                {
                  borderTopColor: colors.borderSubtle,
                  color: colors.textPrimary,
                },
              ]}
              textAlignVertical="top"
              value={description}
            />
            {!orchestrator ? (
              <TextInput
                accessibilityLabel="Agent goal"
                onChangeText={setGoal}
                placeholder="Meta opcional da sessão"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.goalInput,
                  {
                    borderTopColor: colors.borderSubtle,
                    color: colors.textPrimary,
                  },
                ]}
                value={goal}
              />
            ) : null}
            <View
              style={[
                styles.composerFooter,
                { borderTopColor: colors.borderSubtle },
              ]}
            >
              <View style={styles.destination}>
                <Text
                  style={[styles.destinationLabel, { color: colors.textMuted }]}
                >
                  Destino
                </Text>
                <Text
                  style={[
                    styles.destinationValue,
                    { color: colors.textPrimary },
                  ]}
                >
                  {orchestrator
                    ? "Fila do orquestrador"
                    : "Task + sessão vinculada"}
                </Text>
              </View>
              <View style={styles.composerActions}>
                <Pressable
                  accessibilityLabel="Add task context"
                  accessibilityRole="button"
                  style={[
                    styles.iconButton,
                    { backgroundColor: colors.bgRaised },
                  ]}
                >
                  <Plus size={20} color={colors.textPrimary} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Create task"
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: !valid || submitting || loading,
                  }}
                  disabled={!valid || submitting || loading}
                  onPress={submit}
                  style={[
                    styles.submit,
                    {
                      backgroundColor: colors.textPrimary,
                      opacity: !valid || submitting || loading ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.submitText, { color: colors.bgBase }]}>
                    {submitting
                      ? "Criando…"
                      : orchestrator
                        ? "Criar task"
                        : "Criar e abrir"}
                  </Text>
                  {!submitting ? (
                    <ArrowUpRight size={16} color={colors.bgBase} />
                  ) : null}
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>

        {pickerConfig ? (
          <PickerModal
            visible={Boolean(picker)}
            title={pickerConfig.title}
            options={pickerConfig.options}
            selected={pickerConfig.selected}
            onClose={() => setPicker(null)}
            onSelect={selectPickerValue}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ExecutionChoice({
  accessibilityLabel,
  icon,
  label,
  onPress,
  selected,
}: {
  accessibilityLabel: string;
  icon: ReactNode;
  label: string;
  onPress(): void;
  selected: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.executionChoice,
        {
          backgroundColor: selected ? colors.accentSoft : "transparent",
          borderColor: selected ? colors.accent : "transparent",
        },
      ]}
    >
      {icon}
      <Text style={{ color: selected ? colors.accent : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SelectionRow({
  accessibilityLabel,
  icon,
  label,
  subtitle,
  muted = false,
  onPress,
}: {
  accessibilityLabel: string;
  icon: ReactNode;
  label: string;
  subtitle?: string;
  muted?: boolean;
  onPress?(): void;
}) {
  const { colors } = useAppTheme();
  const content = (
    <>
      <View style={styles.selectionIcon}>{icon}</View>
      <View style={styles.selectionCopy}>
        <Text
          numberOfLines={1}
          style={[
            styles.selectionLabel,
            { color: muted ? colors.textMuted : colors.textPrimary },
          ]}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[styles.selectionSubtitle, { color: colors.textMuted }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronDown size={16} color={colors.textMuted} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectionRow,
        { borderBottomColor: colors.borderSubtle },
        pressed && { backgroundColor: colors.bgPressed },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.selectionRow, { borderBottomColor: colors.borderSubtle }]}
    >
      {content}
    </View>
  );
}

function taskPickerConfig({
  picker,
  projects,
  statuses,
  repositories,
  catalog,
  selectedAgent,
  selectedModel,
  projectSlug,
  status,
  targetRepository,
  agent,
  model,
  effort,
}: {
  picker: TaskPicker;
  projects: ProjectSummary[];
  statuses: string[];
  repositories: Array<{ githubFullName: string; workspacePath: string }>;
  catalog: AssistantCatalog | null;
  selectedAgent: AssistantCatalog["agents"][number] | null;
  selectedModel: AssistantCatalog["agents"][number]["models"][number] | null;
  projectSlug: string | null;
  status: string;
  targetRepository: string | null;
  agent: AgentKind;
  model: string | null;
  effort: string | null;
}): { title: string; options: PickerOption[]; selected: string } | null {
  switch (picker) {
    case "project":
      return {
        title: "Selecionar projeto",
        options: projects.map((item) => ({
          value: item.slug,
          label: item.name,
        })),
        selected: projectSlug ?? "",
      };
    case "status":
      return {
        title: "Status inicial",
        options: statuses.map((item) => ({ value: item, label: item })),
        selected: status,
      };
    case "repository":
      return {
        title: "Repositório alvo",
        options: repositories.map((item) => ({
          value: item.githubFullName,
          label: item.githubFullName,
          subtitle: item.workspacePath,
        })),
        selected: targetRepository ?? "",
      };
    case "agent":
      return {
        title: "Agente",
        options:
          catalog?.agents.map((item) => ({
            value: item.agent,
            label: item.agentLabel,
          })) ?? [],
        selected: agent,
      };
    case "model":
      return {
        title: "Modelo",
        options:
          selectedAgent?.models.map((item) => ({
            value: item.model,
            label: item.label,
          })) ?? [],
        selected: model ?? "",
      };
    case "effort":
      return {
        title: "Esforço",
        options:
          selectedModel?.efforts.map((item) => ({
            value: item.effort,
            label: item.label,
          })) ?? [],
        selected: effort ?? "",
      };
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  back: { fontSize: 34, lineHeight: 36 },
  heading: { fontSize: 20, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { gap: spacing.xs },
  introCopy: { fontSize: 15, lineHeight: 21 },
  errorCard: { borderRadius: radii.md, borderWidth: 1, padding: spacing.md },
  segmented: {
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
  },
  executionChoice: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  helper: { fontSize: 13, lineHeight: 18 },
  contextList: { gap: 0 },
  selectionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  selectionIcon: { alignItems: "center", justifyContent: "center", width: 30 },
  selectionCopy: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  selectionLabel: { fontSize: 15 },
  selectionSubtitle: { fontSize: 12, marginTop: 2 },
  contract: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  contractCopy: { flex: 1, fontSize: 12, lineHeight: 17 },
  composer: { borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  titleInput: { fontSize: 17, minHeight: 54, paddingHorizontal: spacing.md },
  descriptionInput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    minHeight: 104,
    padding: spacing.md,
  },
  goalInput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  composerFooter: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  destination: { flex: 1, minWidth: 0 },
  destinationLabel: { fontSize: 11 },
  destinationValue: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  composerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  submit: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  submitText: { fontSize: 13, fontWeight: "700" },
});
