import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FolderGit2,
  GitBranch,
  ListTodo,
  MessageSquare,
  Plus,
} from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import type { IssueSummary, ProjectSessionRow } from "../../../../src/api/contracts";
import {
  buildCreateThreadInput,
  createInitialNewSessionState,
  type WorkspaceMode,
} from "../../../../src/features/sessions/new-session-state";
import { BottomDrawer } from "../../../../src/dev10x/components/BottomDrawer";
import { PickerModal, type PickerOption } from "../../../../src/dev10x/components/PickerModal";
import { createHostTrackerClient } from "../../../../src/dev10x/transport/host-tracker-client";
import { useHostClient } from "../../../../src/dev10x/transport/client-context";
import type { RpcSuccess } from "../../../../src/dev10x/transport/types";
import type { Worktree } from "../../../../src/dev10x/worktree/workspace-list-types";
import { colors, radii, spacing, typography } from "../../../../src/dev10x/theme/mobile-theme";

type CreateMode = "menu" | "session" | "task" | null;

export default function HostProjectPage() {
  const { hostId, projectSlug: encodedProjectSlug } = useLocalSearchParams<{
    hostId: string;
    projectSlug: string;
  }>();
  const projectSlug = decodeURIComponent(encodedProjectSlug);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, state } = useHostClient(hostId);
  const tracker = useMemo(
    () => (client && hostId ? createHostTrackerClient(hostId, client) : null),
    [client, hostId],
  );
  const [sessions, setSessions] = useState<ProjectSessionRow[]>([]);
  const [tasks, setTasks] = useState<IssueSummary[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [projectName, setProjectName] = useState(projectSlug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [taskPickerVisible, setTaskPickerVisible] = useState(false);
  const [workspacePickerVisible, setWorkspacePickerVisible] = useState(false);
  const [newWorkspaceVisible, setNewWorkspaceVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("default");
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Worktree[]>([]);
  const [sessionPrompt, setSessionPrompt] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tracker) return;
    setLoading(true);
    setError(null);
    try {
      // Workspace inventory only enriches the session picker. A transient
      // inventory failure must not discard the project workflow metadata: in
      // particular, a user still needs the server-provided status to create a
      // task from this screen.
      const workspaceRequest = client
        ? client.sendRequest("worktree.ps", { limit: 10000 }).catch(() => null)
        : Promise.resolve(null);
      const [projectSummaries, sessionPage, projectTasks, formOptions, workspaceResponse] =
        await Promise.all([
          tracker.projects(),
          tracker.projectSessions(projectSlug, { limit: 20 }),
          tracker.issues(projectSlug),
          tracker.issueFormOptions(projectSlug),
          workspaceRequest,
        ]);
      setSessions(sessionPage.sessions);
      setTasks(projectTasks);
      setStatuses(formOptions.statuses);
      setProjectName(
        projectSummaries.find((project) => project.slug === projectSlug)?.name ?? projectSlug,
      );
      if (workspaceResponse?.ok) {
        const result = (workspaceResponse as RpcSuccess).result as { worktrees?: Worktree[] };
        setWorkspaces(result.worktrees ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o projeto");
    } finally {
      setLoading(false);
    }
  }, [client, projectSlug, tracker]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeCreate = useCallback(() => {
    setCreateMode(null);
    setTaskPickerVisible(false);
    setWorkspacePickerVisible(false);
    setNewWorkspaceVisible(false);
    setCreateError(null);
  }, []);

  const openNewSession = useCallback(() => {
    setSelectedTask("");
    setWorkspaceMode("default");
    setSelectedWorkspacePath(null);
    setSessionPrompt("");
    setNewWorkspaceName("");
    setCreateError(null);
    setCreateMode("session");
  }, []);

  const openNewTask = useCallback(() => {
    setTaskTitle("");
    setTaskDescription("");
    setCreateError(null);
    setCreateMode("task");
  }, []);

  const startSession = useCallback(async () => {
    if (!tracker || !sessionPrompt.trim()) {
      setCreateError("Escreva uma mensagem para iniciar a sessão");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const initial = createInitialNewSessionState();
      const thread = await tracker.createThread(
        buildCreateThreadInput({
          ...initial,
          scope: "project",
          projectSlug,
          issueIdentifier: selectedTask || null,
          workspaceMode,
          workspacePath: selectedWorkspacePath,
        }),
      );
      closeCreate();
      const params = new URLSearchParams({
        name: sessionPrompt.trim(),
        seed: sessionPrompt.trim(),
      });
      router.push(`/h/${hostId}/chat/${thread.id}?${params.toString()}`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Não foi possível criar a sessão");
    } finally {
      setSubmitting(false);
    }
  }, [
    closeCreate,
    hostId,
    projectSlug,
    router,
    selectedTask,
    selectedWorkspacePath,
    sessionPrompt,
    tracker,
    workspaceMode,
  ]);

  const createTask = useCallback(async () => {
    if (!tracker || !taskTitle.trim()) {
      setCreateError("Informe o título da task");
      return;
    }
    const status = statuses[0];
    if (!status) {
      setCreateError("O projeto não possui um status disponível para novas tasks");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      await tracker.createIssue(projectSlug, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || null,
        status,
      });
      setTaskTitle("");
      setTaskDescription("");
      closeCreate();
      await load();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Não foi possível criar a task");
    } finally {
      setSubmitting(false);
    }
  }, [closeCreate, load, projectSlug, statuses, taskDescription, taskTitle, tracker]);

  const selectedTaskLabel = tasks.find(
    (task) => task.identifier === selectedTask,
  )?.displayIdentifier;
  const taskOptions: PickerOption[] = [
    { value: "", label: "Sem task", subtitle: "Criar uma sessão de projeto" },
    ...tasks.map((task) => ({
      value: task.identifier,
      label: task.displayIdentifier,
      subtitle: task.title,
    })),
  ];
  const workspacePickerValue =
    workspaceMode === "existing"
      ? `existing:${workspaces.find((workspace) => workspace.path === selectedWorkspacePath)?.worktreeId ?? ""}`
      : workspaceMode;
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.path === selectedWorkspacePath,
  );
  const workspaceLabel =
    workspaceMode === "existing"
      ? (selectedWorkspace?.displayName ?? "Workspace existente")
      : workspaceMode === "isolated"
        ? "Novo workspace isolado"
        : workspaceMode === "parent"
          ? "Workspace da task pai"
          : selectedTask
            ? "Workspace da task"
            : "Workspace compartilhado";
  const workspaceOptions: PickerOption[] = [
    {
      value: "default",
      label: selectedTask ? "Workspace da task" : "Workspace compartilhado",
      subtitle: selectedTask
        ? "Usar o workspace padrão desta task"
        : "Usar o workspace padrão do projeto",
    },
    {
      value: "new",
      label: "Novo workspace multi-repo",
      subtitle: "Criar uma cópia de todos os repositórios do projeto",
    },
    ...workspaces.map((workspace) => ({
      value: `existing:${workspace.worktreeId}`,
      label: workspace.displayName,
      subtitle: `${workspace.repo} · ${workspace.branch}`,
    })),
    ...(selectedTask
      ? [
          {
            value: "isolated",
            label: "Novo workspace isolado",
            subtitle: "Criar um workspace exclusivo para esta task",
          },
          {
            value: "parent",
            label: "Workspace da task pai",
            subtitle: "Continuar no workspace da task relacionada",
          },
        ]
      : []),
  ];

  const selectTask = useCallback((identifier: string) => {
    setSelectedTask(identifier);
    if (!identifier) {
      setWorkspaceMode((current) =>
        current === "isolated" || current === "parent" ? "default" : current,
      );
    }
  }, []);

  const selectWorkspace = useCallback(
    (value: string) => {
      if (value === "new") {
        setWorkspacePickerVisible(false);
        setNewWorkspaceVisible(true);
        return;
      }
      if (value === "default" || value === "isolated" || value === "parent") {
        setWorkspaceMode(value as WorkspaceMode);
        setSelectedWorkspacePath(null);
        return;
      }
      const workspaceId = value.slice("existing:".length);
      const workspace = workspaces.find((item) => item.worktreeId === workspaceId);
      if (workspace) {
        setWorkspaceMode("existing");
        setSelectedWorkspacePath(workspace.path);
      }
    },
    [workspaces],
  );

  const createMultiRepoWorkspace = useCallback(async () => {
    if (!client || !newWorkspaceName.trim()) {
      setCreateError("Informe um nome para o workspace");
      return;
    }
    if (!sessionPrompt.trim()) {
      setCreateError("Escreva uma mensagem para iniciar a sessão");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const response = await client.sendRequest("projects.request", {
        path: `/projects/${encodeURIComponent(projectSlug)}/workspaces`,
        method: "POST",
        body: {
          name: newWorkspaceName.trim(),
          title: newWorkspaceName.trim(),
        },
        idempotency_key: createInitialNewSessionState().requestKey,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = response.result as { data?: { thread?: { id?: string | number } } };
      const threadId = result.data?.thread?.id;
      if (threadId == null) throw new Error("O host não retornou a sessão do novo workspace");
      closeCreate();
      const params = new URLSearchParams({
        name: newWorkspaceName.trim(),
        seed: sessionPrompt.trim(),
      });
      router.push(`/h/${hostId}/chat/${threadId}?${params.toString()}`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Não foi possível criar o workspace");
    } finally {
      setSubmitting(false);
    }
  }, [client, closeCreate, hostId, newWorkspaceName, projectSlug, router, sessionPrompt]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.back()}
          accessibilityLabel="Voltar"
        >
          <ChevronLeft size={21} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {projectName}
        </Text>
        <Pressable
          style={styles.createIconButton}
          onPress={() => setCreateMode("menu")}
          accessibilityLabel="Criar"
        >
          <Plus size={20} color={colors.bgBase} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <Text style={styles.title}>{projectName}</Text>
        <Text style={styles.subtitle}>
          {state === "connected" ? "Projeto nesta máquina." : "Reconectando à máquina…"}
        </Text>

        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : (
          <>
            <Section title="Sessões recentes" empty="Nenhuma sessão neste projeto ainda.">
              {sessions.slice(0, 4).map((session) => (
                <Pressable
                  key={session.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => {
                    if (session.threadId) {
                      router.push(`/h/${hostId}/chat/${session.threadId}`);
                    }
                  }}
                  disabled={!session.threadId}
                >
                  <View style={styles.rowIcon}>
                    <MessageSquare size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {session.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {session.issueIdentifier ? `${session.issueIdentifier} · ` : ""}
                      {session.scope}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={colors.textMuted} />
                </Pressable>
              ))}
            </Section>

            <Section title="Tasks" empty="Nenhuma task neste projeto ainda.">
              {tasks.slice(0, 5).map((task) => (
                <View key={task.id} style={styles.row}>
                  <View style={styles.rowIcon}>
                    <ListTodo size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {task.displayIdentifier} · {task.status}
                    </Text>
                  </View>
                </View>
              ))}
            </Section>

            <Text style={styles.sectionTitle}>Workspace padrão</Text>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.replace(`/h/${hostId}`)}
            >
              <View style={styles.rowIcon}>
                <GitBranch size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>Workspaces da máquina</Text>
                <Text style={styles.rowSub}>Abrir ou criar um workspace avançado</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          </>
        )}
      </ScrollView>

      <BottomDrawer visible={createMode === "menu"} onClose={closeCreate} contentScrollable={false}>
        <Text style={styles.drawerTitle}>Criar no projeto</Text>
        <Text style={styles.drawerSub}>{projectName}</Text>
        <Pressable
          style={({ pressed }) => [styles.createChoice, pressed && styles.rowPressed]}
          onPress={openNewSession}
        >
          <View style={styles.rowIcon}>
            <MessageSquare size={20} color={colors.textSecondary} />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Nova sessão</Text>
            <Text style={styles.rowSub}>Começar trabalho interativo</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.createChoice, pressed && styles.rowPressed]}
          onPress={openNewTask}
        >
          <View style={styles.rowIcon}>
            <FilePlus2 size={20} color={colors.textSecondary} />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Nova task</Text>
            <Text style={styles.rowSub}>Registrar trabalho para acompanhar</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
      </BottomDrawer>

      <BottomDrawer visible={createMode === "session"} onClose={closeCreate}>
        <Text style={styles.drawerTitle}>Nova sessão</Text>
        <Text style={styles.drawerSub}>O projeto já está selecionado.</Text>
        <View style={styles.contextList}>
          <ContextRow
            icon={<FolderGit2 size={18} color={colors.textSecondary} />}
            value={projectName}
          />
          <Pressable style={styles.contextRow} onPress={() => setTaskPickerVisible(true)}>
            <ListTodo size={18} color={colors.textSecondary} />
            <Text style={[styles.contextValue, !selectedTask && styles.contextPlaceholder]}>
              {selectedTaskLabel ? `${selectedTaskLabel}` : "Selecionar task"}
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable style={styles.contextRow} onPress={() => setWorkspacePickerVisible(true)}>
            <GitBranch size={18} color={colors.textSecondary} />
            <Text style={styles.contextValue}>{workspaceLabel}</Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>
        <TextInput
          style={[styles.input, styles.promptInput]}
          value={sessionPrompt}
          onChangeText={setSessionPrompt}
          placeholder="No que você quer trabalhar?"
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          selectionColor={colors.accentBlue}
        />
        {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryPressed,
            submitting && styles.primaryDisabled,
          ]}
          onPress={() => void startSession()}
          disabled={submitting}
        >
          <Text style={styles.primaryText}>{submitting ? "Criando…" : "Iniciar sessão"}</Text>
        </Pressable>
      </BottomDrawer>

      <BottomDrawer visible={createMode === "task"} onClose={closeCreate}>
        <Text style={styles.drawerTitle}>Nova task</Text>
        <Text style={styles.drawerSub}>A task será criada apenas neste projeto.</Text>
        <TextInput
          style={styles.input}
          value={taskTitle}
          onChangeText={setTaskTitle}
          placeholder="O que precisa ser feito?"
          placeholderTextColor={colors.textMuted}
          autoFocus
          selectionColor={colors.accentBlue}
        />
        <TextInput
          style={[styles.input, styles.descriptionInput]}
          value={taskDescription}
          onChangeText={setTaskDescription}
          placeholder="Contexto, objetivo ou critérios de aceite (opcional)"
          placeholderTextColor={colors.textMuted}
          multiline
          selectionColor={colors.accentBlue}
        />
        {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryPressed,
            submitting && styles.primaryDisabled,
          ]}
          onPress={() => void createTask()}
          disabled={submitting}
        >
          <Text style={styles.primaryText}>{submitting ? "Criando…" : "Criar task"}</Text>
        </Pressable>
      </BottomDrawer>

      <BottomDrawer visible={newWorkspaceVisible} onClose={() => setNewWorkspaceVisible(false)}>
        <Text style={styles.drawerTitle}>Novo workspace multi-repo</Text>
        <Text style={styles.drawerSub}>
          Todos os repositórios de {projectName} serão clonados em um único workspace.
        </Text>
        <Text style={styles.workspaceNote}>
          As branches configuradas do projeto serão usadas como padrão.
        </Text>
        <TextInput
          style={styles.input}
          value={newWorkspaceName}
          onChangeText={setNewWorkspaceName}
          placeholder="Nome do workspace"
          placeholderTextColor={colors.textMuted}
          autoFocus
          selectionColor={colors.accentBlue}
        />
        {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryPressed,
            submitting && styles.primaryDisabled,
          ]}
          onPress={() => void createMultiRepoWorkspace()}
          disabled={submitting}
        >
          <Text style={styles.primaryText}>
            {submitting ? "Criando…" : "Criar workspace e iniciar sessão"}
          </Text>
        </Pressable>
      </BottomDrawer>

      <PickerModal
        visible={taskPickerVisible}
        title="Selecionar task"
        options={taskOptions}
        selected={selectedTask}
        onSelect={selectTask}
        onClose={() => setTaskPickerVisible(false)}
      />
      <PickerModal
        visible={workspacePickerVisible}
        title="Selecionar workspace"
        options={workspaceOptions}
        selected={workspacePickerValue}
        onSelect={selectWorkspace}
        onClose={() => setWorkspacePickerVisible(false)}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {Array.isArray(rows) && rows.length === 0 ? (
        <Text style={styles.emptyCopy}>{empty}</Text>
      ) : (
        <View style={styles.rows}>{children}</View>
      )}
    </View>
  );
}

function ContextRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <View style={styles.contextRow}>
      {icon}
      <Text style={styles.contextValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    height: 58,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  createIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceBright,
  },
  headerTitle: {
    maxWidth: "65%",
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: "600",
  },
  content: { padding: spacing.lg, paddingTop: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: typography.bodySize, marginTop: spacing.xs },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  rows: { gap: spacing.sm },
  row: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.row,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgRaised,
    marginRight: spacing.md,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: typography.metaSize, marginTop: 2 },
  stateCard: { paddingTop: spacing.xl * 3, alignItems: "center" },
  errorText: { color: colors.statusRed, fontSize: typography.metaSize, marginTop: spacing.sm },
  retry: { marginTop: spacing.md, padding: spacing.sm },
  retryText: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: "600" },
  emptyCopy: { color: colors.textMuted, fontSize: typography.bodySize },
  drawerTitle: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: "700" },
  drawerSub: {
    color: colors.textMuted,
    fontSize: typography.bodySize,
    marginTop: 3,
    marginBottom: spacing.md,
  },
  createChoice: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingVertical: spacing.md,
  },
  contextList: { gap: spacing.sm, marginBottom: spacing.md },
  contextRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  contextValue: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize },
  contextPlaceholder: { color: colors.textSecondary },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.bodySize,
    marginTop: spacing.sm,
  },
  promptInput: { minHeight: 96, textAlignVertical: "top" },
  descriptionInput: { minHeight: 104, textAlignVertical: "top" },
  workspaceNote: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginBottom: spacing.sm,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceBright,
    borderRadius: radii.button,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 3,
  },
  primaryPressed: { opacity: 0.75 },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: "700" },
});
