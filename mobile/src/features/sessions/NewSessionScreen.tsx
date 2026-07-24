import { ArrowLeft, ChevronRight, SendHorizontal, SlidersHorizontal } from "lucide-react-native";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  AssistantCatalog,
  AssistantThread,
  CreateThreadInput,
  ProjectSummary,
} from "@/api/contracts";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import {
  buildCreateThreadInput,
  type NewSessionState,
  newSessionReducer,
  validateNewSession,
  type WorkspaceMode,
} from "./new-session-state";

type NewSessionScreenProps = {
  connectionName: string;
  projects: ProjectSummary[];
  initialState: NewSessionState;
  createThread(input: CreateThreadInput): Promise<AssistantThread>;
  loadCatalog(projectSlug: string): Promise<AssistantCatalog>;
  onBack(): void;
  onCreated(threadId: number, prompt: string): void;
  onDraftChange(state: NewSessionState): void;
};

export function NewSessionScreen({
  connectionName,
  projects,
  initialState,
  createThread,
  loadCatalog,
  onBack,
  onCreated,
  onDraftChange,
}: NewSessionScreenProps) {
  const { colors } = useAppTheme();
  const [state, dispatch] = useReducer(newSessionReducer, initialState);
  const [advanced, setAdvanced] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [agentModal, setAgentModal] = useState(false);
  const [modelModal, setModelModal] = useState(false);
  const [effortModal, setEffortModal] = useState(false);
  const [catalog, setCatalog] = useState<AssistantCatalog | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => onDraftChange(state), [onDraftChange, state]);
  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    if (!state.projectSlug) return;
    void loadCatalog(state.projectSlug)
      .then((nextCatalog) => {
        if (!cancelled) setCatalog(nextCatalog);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, state.projectSlug]);

  const project = projects.find((item) => item.slug === state.projectSlug) ?? null;
  const canSubmit = validateNewSession(state).valid && !submitting;

  async function submit() {
    const validation = validateNewSession(state);
    if (submittingRef.current || !validation.valid) {
      if (!validation.valid) setError(validation.message);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const thread = await createThread(buildCreateThreadInput(state));
      onCreated(thread.id, state.prompt.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create session");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safeArea}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onBack}
            style={[
              styles.roundButton,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>New chat</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            accessibilityLabel="Message"
            autoFocus
            multiline
            onChangeText={(prompt) => dispatch({ type: "set_prompt", prompt })}
            placeholder="What do you want to build?"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={[
              styles.prompt,
              {
                backgroundColor: colors.bgPanel,
                borderColor: error ? colors.statusRed : colors.borderStrong,
                color: colors.textPrimary,
              },
            ]}
            textAlignVertical="top"
            value={state.prompt}
          />

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
              {error}
            </Text>
          ) : null}

          <View
            style={[
              styles.contextCard,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <ContextRow label="Connection" value={connectionName} />
            <ContextRow
              accessibilityLabel="Choose project"
              label="Project"
              onPress={() => setProjectModal(true)}
              value={project?.name ?? "Free"}
            />
            {state.scope === "project" ? (
              <>
                <ContextInputRow
                  accessibilityLabel="Issue identifier"
                  label="Issue"
                  onChangeText={(identifier) =>
                    dispatch({ type: "set_issue", identifier: identifier || null })
                  }
                  placeholder="Optional"
                  value={state.issueIdentifier ?? ""}
                />
                <ContextRow
                  accessibilityLabel="Choose workspace"
                  label="Workspace"
                  onPress={() => setWorkspaceModal(true)}
                  value={workspaceLabel(state.workspaceMode, state.workspacePath)}
                />
                {state.workspaceMode === "existing" ? (
                  <ContextInputRow
                    accessibilityLabel="Workspace path"
                    label="Path"
                    onChangeText={(path) =>
                      dispatch({ type: "set_workspace", mode: "existing", path })
                    }
                    placeholder="/path/to/workspace"
                    value={state.workspacePath ?? ""}
                  />
                ) : null}
                {state.workspaceMode === "isolated" ? (
                  <ContextInputRow
                    accessibilityLabel="Clone branch"
                    label="Branch"
                    onChangeText={(branch) =>
                      dispatch({ type: "set_branch", branch: branch || null })
                    }
                    placeholder="Optional"
                    value={state.branch ?? ""}
                  />
                ) : null}
              </>
            ) : null}
          </View>

          <Pressable
            accessibilityLabel={advanced ? "Hide advanced options" : "Show advanced options"}
            accessibilityRole="button"
            onPress={() => setAdvanced((value) => !value)}
            style={styles.advancedButton}
          >
            <SlidersHorizontal color={colors.textMuted} size={17} />
            <Text style={[styles.advancedLabel, { color: colors.textSecondary }]}>
              {advanced ? "Hide advanced" : "Advanced"}
            </Text>
          </Pressable>

          {advanced ? (
            <View
              style={[
                styles.contextCard,
                { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
              ]}
            >
              <ContextRow
                accessibilityLabel="Choose agent"
                label="Agent"
                onPress={catalog ? () => setAgentModal(true) : undefined}
                value={agentLabel(state.agentKind, catalog)}
              />
              <ContextRow
                accessibilityLabel="Choose model"
                label="Model"
                onPress={
                  activeAgent(catalog, state.agentKind) ? () => setModelModal(true) : undefined
                }
                value={state.model ?? "Default"}
              />
              {state.model ? (
                <ContextRow
                  accessibilityLabel="Choose effort"
                  label="Effort"
                  onPress={
                    activeModel(catalog, state.agentKind, state.model)
                      ? () => setEffortModal(true)
                      : undefined
                  }
                  value={effortLabel(catalog, state.agentKind, state.model, state.effort)}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.sendBar,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.sendHint, { color: colors.textMuted }]}>
            {state.scope === "free" ? "Free session" : project?.name}
          </Text>
          <Pressable
            accessibilityLabel={submitting ? "Creating session" : error ? "Retry" : "Send"}
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: canSubmit ? colors.textPrimary : colors.bgPressed,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.bgBase} size="small" />
            ) : (
              <SendHorizontal color={canSubmit ? colors.bgBase : colors.textMuted} size={21} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ChoiceModal onClose={() => setProjectModal(false)} title="Project" visible={projectModal}>
        <Choice
          label="Free"
          onPress={() => {
            dispatch({ type: "set_scope", scope: "free" });
            setProjectModal(false);
          }}
        />
        {projects.map((item) => (
          <Choice
            accessibilityLabel={`Use ${item.name} project`}
            key={item.id}
            label={item.name}
            onPress={() => {
              dispatch({ type: "set_scope", scope: "project" });
              dispatch({ type: "set_project", projectSlug: item.slug });
              setProjectModal(false);
            }}
          />
        ))}
      </ChoiceModal>

      <ChoiceModal
        onClose={() => setWorkspaceModal(false)}
        title="Workspace"
        visible={workspaceModal}
      >
        {(
          [
            ["default", "Default workspace"],
            ["existing", "Existing workspace"],
            ...(state.issueIdentifier
              ? ([
                  ["parent", "Parent workspace"],
                  ["isolated", "New isolated workspace"],
                ] satisfies [WorkspaceMode, string][])
              : []),
          ] satisfies [WorkspaceMode, string][]
        ).map(([mode, label]) => (
          <Choice
            key={mode}
            label={label}
            onPress={() => {
              dispatch({ type: "set_workspace", mode });
              setWorkspaceModal(false);
            }}
          />
        ))}
      </ChoiceModal>

      <ChoiceModal onClose={() => setAgentModal(false)} title="Agent" visible={agentModal}>
        {catalog?.agents.map((agent) => (
          <Choice
            key={agent.agent}
            label={agent.agentLabel}
            onPress={() => {
              dispatch({ type: "set_agent", agentKind: agent.agent });
              setAgentModal(false);
            }}
          />
        ))}
      </ChoiceModal>

      <ChoiceModal onClose={() => setModelModal(false)} title="Model" visible={modelModal}>
        <Choice
          label="Default"
          onPress={() => {
            dispatch({ type: "set_model", model: null, effort: null });
            setModelModal(false);
          }}
        />
        {activeAgent(catalog, state.agentKind)?.models.map((model) => (
          <Choice
            key={model.model}
            label={model.label}
            onPress={() => {
              dispatch({
                type: "set_model",
                model: model.model,
                effort: model.efforts[0]?.effort ?? null,
              });
              setModelModal(false);
            }}
          />
        ))}
      </ChoiceModal>

      <ChoiceModal onClose={() => setEffortModal(false)} title="Effort" visible={effortModal}>
        {activeModel(catalog, state.agentKind, state.model)?.efforts.map((effort) => (
          <Choice
            key={effort.effort}
            label={effort.label}
            onPress={() => {
              dispatch({ type: "set_model", model: state.model, effort: effort.effort });
              setEffortModal(false);
            }}
          />
        ))}
      </ChoiceModal>
    </SafeAreaView>
  );
}

function ContextInputRow({
  accessibilityLabel,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  accessibilityLabel: string;
  label: string;
  onChangeText(value: string): void;
  placeholder: string;
  value: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.contextRow}>
      <Text style={[styles.contextLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.contextInput, { color: colors.textPrimary }]}
        value={value}
      />
    </View>
  );
}

function ContextRow({
  accessibilityLabel,
  label,
  onPress,
  value,
}: {
  accessibilityLabel?: string;
  label: string;
  onPress?: (() => void) | undefined;
  value: string;
}) {
  const { colors } = useAppTheme();
  const content = (
    <>
      <Text style={[styles.contextLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.contextValue, { color: colors.textPrimary }]}>
        {value}
      </Text>
      {onPress ? <ChevronRight color={colors.textMuted} size={17} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.contextRow}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.contextRow}>{content}</View>
  );
}

function ChoiceModal({
  children,
  onClose,
  title,
  visible,
}: {
  children: React.ReactNode;
  onClose(): void;
  title: string;
  visible: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable
          accessibilityViewIsModal
          onPress={(event) => event.stopPropagation()}
          style={[
            styles.modalSheet,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Choice({
  accessibilityLabel,
  label,
  onPress,
}: {
  accessibilityLabel?: string;
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { borderColor: colors.borderSubtle, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <Text style={[styles.choiceLabel, { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function workspaceLabel(mode: WorkspaceMode, path: string | null): string {
  if (mode === "existing") return path ?? "Existing workspace";
  if (mode === "parent") return "Parent workspace";
  if (mode === "isolated") return "New isolated workspace";
  return "Default workspace";
}

function agentLabel(
  agentKind: NewSessionState["agentKind"],
  catalog: AssistantCatalog | null,
): string {
  return (
    catalog?.agents.find((agent) => agent.agent === agentKind)?.agentLabel ??
    `${agentKind.slice(0, 1).toUpperCase()}${agentKind.slice(1)}`
  );
}

function activeAgent(catalog: AssistantCatalog | null, agentKind: NewSessionState["agentKind"]) {
  return catalog?.agents.find((agent) => agent.agent === agentKind) ?? null;
}

function activeModel(
  catalog: AssistantCatalog | null,
  agentKind: NewSessionState["agentKind"],
  model: string | null,
) {
  return activeAgent(catalog, agentKind)?.models.find((item) => item.model === model) ?? null;
}

function effortLabel(
  catalog: AssistantCatalog | null,
  agentKind: NewSessionState["agentKind"],
  model: string,
  effort: string | null,
) {
  if (!effort) return "Default";
  return (
    activeModel(catalog, agentKind, model)?.efforts.find((item) => item.effort === effort)?.label ??
    effort
  );
}

const styles = StyleSheet.create({
  advancedButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
  },
  advancedLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  choice: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 54,
  },
  choiceLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  contextCard: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
  },
  contextLabel: {
    fontSize: 12,
    width: 82,
  },
  contextInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    paddingVertical: 0,
  },
  contextRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 48,
  },
  contextValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    padding: spacing.md,
  },
  headerSpacer: {
    width: 48,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.6)",
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  prompt: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 19,
    lineHeight: 28,
    minHeight: 180,
    padding: spacing.md,
  },
  roundButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  safeArea: {
    flex: 1,
  },
  sendBar: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  sendHint: {
    flex: 1,
    fontSize: 13,
  },
});
