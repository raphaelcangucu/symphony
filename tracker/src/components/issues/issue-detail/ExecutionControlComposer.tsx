import { Eraser, Play, Send, Sparkles, Square, X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AssistantComposer,
  type AssistantComposerSubmit,
  type ComposerSnapshot,
} from "@/components/assistant/AssistantComposer";
import { assistantCommandsToSlashDefs } from "@/components/assistant/assistantCommandDefs";
import type { AssistantOutgoingAttachment } from "@/components/assistant/assistantAttachments";
import { useComposerMentions } from "@/hooks/useComposerMentions";
import { useContextMentionData } from "@/components/assistant/useContextMentionData";
import { defaultSkillCommands, parseSlashCommand } from "@/components/assistant/slashCommands";
import { ExecutionCommandPalette } from "@/components/issues/issue-detail/ExecutionCommandPalette";
import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { GoalPill } from "@/components/shared/GoalPill";
import { deriveGoalPresentation, normalizeGoalProvider } from "@/components/shared/goalPresentation";
import { useExecutionShortcuts } from "@/hooks/useExecutionShortcuts";
import { useAssistantCommands } from "@/hooks/useAssistantCommands";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveExecutionComposerRoute } from "@/components/assistant/executionComposerRouting";
import { agentEnterHintLabel, canResumeExecution, deriveAgentControl } from "@/lib/agentExecutionDisplay";
import { enrichGuidanceWithAttachments } from "@/lib/enrichComposerGuidance";
import { catalogFor, defaultComposerSettings, fallbackCatalogBundle } from "@/lib/assistantSettings";
import { resolveExecutionComposerSeed } from "@/lib/executionComposerSeed";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import { updateAssistantThread } from "@/services/assistantThreads";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { updateIssue } from "@/services/issues";
import type { RunPromptTemplateResult } from "@/services/magicCommands";
import { controlIssueGoal } from "@/services/goalControl";
import { availableModesFor, cycleMode, DEFAULT_EXECUTION_MODE } from "@/lib/executionMode";
import type { AgentSteerPayload } from "@/hooks/useSessionLogChannel";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, ExecutionMode, Issue } from "@/types/issue";

interface QueuedGuidanceItem {
  text: string;
  attachments: AssistantOutgoingAttachment[];
  fileTexts: Record<string, string>;
}

interface ExecutionControlComposerProps {
  projectSlug: string;
  issue: Issue;
  execution?: AgentExecution;
  sessionConnected?: boolean;
  canSteer?: boolean;
  steerPending?: boolean;
  steerError?: string | null;
  seedMessage?: string | null;
  onSteer: (payload: AgentSteerPayload) => void;
  onIssueUpdated?: (issue: Issue) => void;
}

export function ExecutionControlComposer({
  projectSlug,
  issue,
  execution,
  sessionConnected = false,
  canSteer = false,
  steerPending = false,
  steerError = null,
  seedMessage = null,
  onSteer,
  onIssueUpdated,
}: ExecutionControlComposerProps) {
  const { t } = useTranslation();
  const [queued, setQueued] = useState<QueuedGuidanceItem[]>([]);
  const [bundle, setBundle] = useState(fallbackCatalogBundle());
  const [agent, setAgent] = useState<AgentKind>(issue.agentKind ?? bundle.defaultAgent);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  // Memoized submit handlers may close over a stale render; read mode from a ref
  // so dispatch always forwards the operator's current selection.
  const modeRef = useRef<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [dispatchPending, setDispatchPending] = useState<"resume" | "hard_reset" | "stop" | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [newThreadInstructions, setNewThreadInstructions] = useState<string | null>(null);
  const [magicOpen, setMagicOpen] = useState(false);
  const [goalDismissed, setGoalDismissed] = useState(false);
  const [composerResetToken, setComposerResetToken] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const composerSnapshotRef = useRef<ComposerSnapshot>({ input: "", attachments: [] });
  const composerSettingsRef = useRef<{ model: string | null; effort: string | null }>({
    model: null,
    effort: null,
  });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionOptions = useContextMentionData(projectSlug, issue.identifier, mentionQuery);
  const {
    commands: assistantCommands,
    isLoading: assistantCommandsLoading,
    error: assistantCommandsError,
  } = useAssistantCommands({ projectSlug, context: "execution" });
  const slashCommandExtras = useMemo(() => {
    if (assistantCommandsLoading || assistantCommandsError) {
      return defaultSkillCommands(t, "execution");
    }
    return assistantCommandsToSlashDefs(assistantCommands, t);
  }, [assistantCommands, assistantCommandsError, assistantCommandsLoading, t]);
  const { rememberMention, expandMentions } = useComposerMentions();

  // Goal visibility follows the durable execution snapshot, never objective
  // text or the cached issue.agentGoal column. Blank objectives use the shared
  // localized fallback in GoalPill.
  const hasExecutionGoal = execution?.goal != null;
  const trimmedGoalObjective = execution?.goal?.objective?.trim() || "";
  const goalObjective = trimmedGoalObjective.length > 0 ? trimmedGoalObjective : null;
  const showGoalPill = !goalDismissed && hasExecutionGoal;

  useEffect(() => {
    if (!hasExecutionGoal) setGoalDismissed(false);
  }, [hasExecutionGoal]);

  const control = deriveAgentControl(execution, t);
  const agentRunActive = control.isActive;
  const canResume = control.canResume;
  const enterIntent = canSteer
    ? "steer"
    : control.isActive
      ? "queue"
      : control.hasRun
        ? "resume"
        : "start";
  const primaryLabel = control.primaryLabel;

  const queuedGuidance = useMemo(
    () => queued.filter((entry) => entry.text.trim().length > 0 || entry.attachments.length > 0),
    [queued],
  );

  const controlsDisabled = dispatchPending !== null;

  useEffect(() => {
    let cancelled = false;
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .catch(() => {
        if (!cancelled) setBundle(fallbackCatalogBundle());
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  // Live/parked runs mirror the orchestrator snapshot; idle/finished runs keep
  // durable issue pins. Catalog defaults apply only when neither source pins a
  // model/effort — never seed fallback gpt-5.5/medium ahead of the remote catalog.
  const composerSeed = useMemo(
    () => resolveExecutionComposerSeed(execution, issue, bundle.defaultAgent),
    [bundle.defaultAgent, execution, issue.agentKind, issue.effort, issue.model],
  );

  useEffect(() => {
    setAgent(composerSeed.agent);
  }, [composerSeed.agent]);

  const settingsSeed = useMemo(() => {
    if (composerSeed.model == null && composerSeed.effort == null) return null;
    const defaults = defaultComposerSettings(catalogFor(bundle, composerSeed.agent));
    return {
      agent: composerSeed.agent,
      model: composerSeed.model ?? defaults.model,
      effort: composerSeed.effort ?? defaults.effort,
    };
  }, [bundle, composerSeed]);

  const persistExecutionSettings = useCallback(
    (nextAgent: AgentKind, model: string | null, effort: string | null) => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        const threadId = execution?.executionSessionId;
        const threadPatch =
          threadId != null && threadId > 0
            ? updateAssistantThread(threadId, { agentKind: nextAgent }).catch(() => {
                toast.error(
                  t("issue.summary.executionSaveFailed", {
                    defaultValue: "Failed to save execution settings",
                  }),
                );
              })
            : Promise.resolve();

        void Promise.all([
          threadPatch,
          updateIssue(projectSlug, issue.identifier, {
            agent: nextAgent,
            model,
            effort,
          }).then((updated) => {
            onIssueUpdated?.(updated);
          }),
        ]).catch(() => {
          toast.error(
            t("issue.summary.executionSaveFailed", { defaultValue: "Failed to save execution settings" }),
          );
        });
      }, 300);
    },
    [execution?.executionSessionId, issue.identifier, onIssueUpdated, projectSlug, t],
  );

  const handleAgentChange = useCallback(
    (next: AgentKind) => {
      setAgent(next);
      persistExecutionSettings(next, composerSettingsRef.current.model, composerSettingsRef.current.effort);
    },
    [persistExecutionSettings],
  );

  const handleSettingsChange = useCallback(
    (nextAgent: AgentKind, next: { model: string | null; effort: string | null }) => {
      composerSettingsRef.current = { model: next.model, effort: next.effort };
      persistExecutionSettings(nextAgent, next.model, next.effort);
    },
    [persistExecutionSettings],
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  // Keep the selected mode valid for the active agent (cursor has no plan mode).
  useEffect(() => {
    const available = availableModesFor(agent);
    setMode((current) => (available.includes(current) ? current : available[0]));
  }, [agent]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const dispatchProgressLabel = useMemo<Record<"resume" | "hard_reset" | "stop", string>>(
    () => ({
      resume: t("issue.agent.dispatchResume"),
      hard_reset: t("issue.agent.dispatchHardReset"),
      stop: t("issue.agent.dispatchStop"),
    }),
    [t],
  );

  const guidanceFromQueued = useCallback(
    (entry: QueuedGuidanceItem): string =>
      enrichGuidanceWithAttachments(entry.text, entry.attachments, projectSlug, entry.fileTexts),
    [projectSlug],
  );

  const guidanceFromSnapshot = useCallback(
    (snapshot: ComposerSnapshot): string => {
      const parsed = parseSlashCommand(snapshot.input, t, "execution");
      const typed = parsed.kind === "message" ? snapshot.input.trim() : parsed.argument.trim();
      return enrichGuidanceWithAttachments(expandMentions(typed), snapshot.attachments, projectSlug, {});
    },
    [expandMentions, projectSlug, t],
  );

  const combinedGuidance = useCallback((): string => {
    const parts = [
      ...queuedGuidance.map((entry) => guidanceFromQueued(entry)),
      guidanceFromSnapshot(composerSnapshotRef.current),
    ].filter((entry) => entry.length > 0);
    return parts.join("\n\n");
  }, [guidanceFromQueued, guidanceFromSnapshot, queuedGuidance]);

  function removeQueued(index: number) {
    setQueued((current) => current.filter((_, i) => i !== index));
  }

  const runDispatch = useCallback(
    async (
      action: "resume" | "hard_reset" | "stop",
      overrides?: {
        goal?: string | null;
        instructions?: string | null;
        contextRefs?: AssistantComposerSubmit["contextRefs"];
      },
    ) => {
      setDispatchPending(action);
      setDispatchError(null);
      setDispatchStatus(dispatchProgressLabel[action]);

      const guidance =
        action === "stop" ? "" : (overrides?.instructions?.trim() || combinedGuidance());
      // Normal resume must not re-send a cached objective; only explicit
      // goal actions set the Codex goal (via controlIssueGoal). Resetting the same
      // objective would reset native goal accounting.
      const dispatchGoal = overrides?.goal ?? null;

      try {
        const result = await dispatchIssueAgent(projectSlug, issue.identifier, {
          action,
          agent,
          goal: dispatchGoal,
          instructions: guidance || null,
          model: composerSettingsRef.current.model,
          effort: composerSettingsRef.current.effort,
          mode: modeRef.current,
          contextRefs: overrides?.contextRefs,
        });
        onIssueUpdated?.(result.issue);
        setDispatchStatus(result.message);
        if (action !== "stop") {
          setQueued([]);
          setComposerResetToken((token) => token + 1);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : t("issue.agent.dispatchFailed");
        setDispatchError(message);
        setDispatchStatus(null);
        toast.error(message);
      } finally {
        setDispatchPending(null);
      }
    },
    [agent, combinedGuidance, dispatchProgressLabel, issue.identifier, onIssueUpdated, projectSlug, t],
  );

  const submitExecutionGoal = useCallback(
    async (objectiveArg: string) => {
      const trimmed = objectiveArg.trim();
      const objective = trimmed.length > 0 ? trimmed : t("issue.agent.goalDefaultObjective");
      const framedInstructions =
        trimmed.length > 0
          ? t("issue.agent.goalCommandWithObjective", { objective: trimmed })
          : t("issue.agent.goalCommandDefault");

      try {
        await controlIssueGoal(projectSlug, issue.identifier, {
          action: "set_objective",
          objective,
        });
        setGoalDismissed(false);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
        return;
      }

      toast.success(t("issue.agent.goalSetDone"));

      if (canSteer) {
        onSteer({ message: framedInstructions, attachments: [] });
        return;
      }

      if (control.isActive) {
        setQueued((current) => [
          ...current,
          {
            text: framedInstructions,
            attachments: [],
            fileTexts: {},
          },
        ]);
        return;
      }

      if (!dispatchPending) {
        // Goal already set natively above; resume only starts the worker.
        await runDispatch("resume", { instructions: framedInstructions });
      }
    },
    [
      canSteer,
      control.isActive,
      dispatchPending,
      issue.identifier,
      onSteer,
      projectSlug,
      runDispatch,
      t,
    ],
  );

  const handleComposerSubmit = useCallback(
    (submit: AssistantComposerSubmit) => {
      if (submit.kind === "goal") {
        void submitExecutionGoal(submit.message);
        return;
      }
      if (submit.kind === "new_thread") {
        const instructions = enrichGuidanceWithAttachments(
          expandMentions(submit.message.trim()),
          submit.attachments,
          projectSlug,
          {},
        );
        setNewThreadInstructions(instructions || null);
        setHardResetOpen(true);
        return;
      }
      if (submit.kind === "btw") return;

      const text = submit.message.trim();
      const expanded = expandMentions(text);
      const hasAttachments = submit.attachments.length > 0;
      const hasContextRefs = submit.contextRefs.length > 0;
      const hasContent = Boolean(text || hasAttachments || hasContextRefs);
      const route = resolveExecutionComposerRoute({
        canSteer,
        isActive: control.isActive,
        hasContent,
        dispatchPending: dispatchPending != null,
      });

      if (route === "steer") {
        onSteer({
          message: expanded,
          attachments: submit.attachments,
          ...(hasContextRefs ? { contextRefs: submit.contextRefs } : {}),
        });
        return;
      }

      if (route === "queue") {
        setQueued((current) => [
          ...current,
          {
            text: expanded,
            attachments: submit.attachments,
            fileTexts: {},
          },
        ]);
        return;
      }

      if (route === "resume") {
        const instructions = enrichGuidanceWithAttachments(expanded, submit.attachments, projectSlug, {});
        void runDispatch("resume", { instructions, contextRefs: submit.contextRefs });
      }
    },
    [
      canSteer,
      control.isActive,
      dispatchPending,
      expandMentions,
      onSteer,
      projectSlug,
      runDispatch,
      submitExecutionGoal,
    ],
  );

  const handleEmptySubmit = useCallback(() => {
    if (canSteer || control.isActive || dispatchPending) return;
    if (canResume) void runDispatch("resume");
  }, [canResume, canSteer, control.isActive, dispatchPending, runDispatch]);

  const sendDisabled =
    controlsDisabled || (canSteer && (!sessionConnected || steerPending));
  const primaryDisabled = controlsDisabled || (!agentRunActive && !canResume);

  const executionGoal = execution?.goal ?? null;
  const goalProvider = normalizeGoalProvider(null, executionGoal?.source);
  const goalCapabilities = executionGoal?.capabilities ?? [];
  const goalPhase = deriveGoalPresentation({
    status: executionGoal?.status,
    processRunning: agentRunActive,
    resumable: execution ? canResumeExecution(execution) : false,
    interrupted: execution?.status === "aborted",
  }).phase;
  const goalTimeUsedSeconds =
    executionGoal?.timeUsedSeconds ?? (agentRunActive ? execution?.runtimeSeconds : null) ?? null;
  const controllableGoal =
    executionGoal?.kind === "goal" && (goalProvider === "codex" || goalProvider === "claude");
  const canStopGoal = controllableGoal && agentRunActive && goalCapabilities.includes("stop");
  const canPauseGoal = controllableGoal && agentRunActive && goalCapabilities.includes("pause");
  const canResumeGoal =
    controllableGoal && !agentRunActive && !dispatchPending && goalCapabilities.includes("resume");
  const canRemoveGoal = controllableGoal && goalCapabilities.includes("clear");
  const canEditGoal =
    controllableGoal &&
    (goalCapabilities.includes("edit") || goalCapabilities.includes("set_objective"));

  function handleGoalStop() {
    if (!canStopGoal) return;
    void runDispatch("stop");
  }

  async function handleGoalPause() {
    if (!canPauseGoal) return;
    try {
      await controlIssueGoal(projectSlug, issue.identifier, { action: "pause" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    }
  }

  async function handleGoalResume() {
    if (!canResumeGoal) return;
    try {
      await controlIssueGoal(projectSlug, issue.identifier, { action: "resume" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    }
  }

  async function handleGoalRemove() {
    if (!canRemoveGoal) return;
    try {
      await controlIssueGoal(projectSlug, issue.identifier, { action: "clear" });
      setGoalDismissed(true);
      toast.success(t("issue.agent.goalControls.clearDone"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    }
  }

  async function handleGoalEdit(objective: string) {
    if (!canEditGoal) return;
    try {
      await controlIssueGoal(projectSlug, issue.identifier, { action: "set_objective", objective });
      setGoalDismissed(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    }
  }

  const composerPlaceholder = canSteer
    ? t("issue.agent.placeholderSteer")
    : agentRunActive
      ? t("issue.agent.placeholderQueue")
      : control.hasRun
        ? t("issue.agent.placeholderResume")
        : t("issue.agent.placeholderStart");

  function handleModeShortcut(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !event.shiftKey) return;
    // Only cycle when typing in the composer textarea; never hijack global
    // Shift+Tab focus traversal from buttons/menus.
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName !== "TEXTAREA") return;
    if (controlsDisabled || agentRunActive) return;
    event.preventDefault();
    setMode((current) => cycleMode(current, availableModesFor(agent)));
  }

  function focusComposer() {
    sectionRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  function cycleExecutionMode() {
    if (controlsDisabled || agentRunActive) return;
    setMode((current) => cycleMode(current, availableModesFor(agent)));
  }

  function toggleMagicPalette() {
    if (controlsDisabled) return;
    setMagicOpen((current) => !current);
  }

  function handleMagicRan(result: RunPromptTemplateResult) {
    onIssueUpdated?.(result.issue);
    setDispatchError(null);
    setDispatchStatus(result.message);
  }

  useExecutionShortcuts({
    onResume: () => {
      if (!controlsDisabled && !agentRunActive) void runDispatch("resume");
    },
    onStop: () => {
      if (!controlsDisabled && agentRunActive) void runDispatch("stop");
    },
    onHardReset: () => {
      if (!controlsDisabled) {
        setNewThreadInstructions(null);
        setHardResetOpen(true);
      }
    },
    onCycleMode: cycleExecutionMode,
    onFocusComposer: focusComposer,
    onMagicOpen: toggleMagicPalette,
    enabled: !controlsDisabled,
  });

  const goalPill = showGoalPill ? (
    <GoalPill
      phase={goalPhase}
      provider={goalProvider}
      capabilities={goalCapabilities}
      objective={goalObjective}
      running={agentRunActive}
      timeUsedSeconds={goalTimeUsedSeconds}
      onStop={canStopGoal ? handleGoalStop : undefined}
      onPause={canPauseGoal ? () => void handleGoalPause() : undefined}
      onResume={canResumeGoal ? () => void handleGoalResume() : undefined}
      onRemove={canRemoveGoal ? () => void handleGoalRemove() : undefined}
      onEditObjective={canEditGoal ? (objective) => void handleGoalEdit(objective) : undefined}
    />
  ) : null;

  return (
    <section
      ref={sectionRef}
      className="min-w-0"
      onKeyDown={handleModeShortcut}
    >
      <ExecutionCommandPalette
        disabled={controlsDisabled}
        onResume={() => {
          if (!agentRunActive) void runDispatch("resume");
        }}
        onStop={() => {
          if (agentRunActive) void runDispatch("stop");
        }}
        onHardReset={() => {
          setNewThreadInstructions(null);
          setHardResetOpen(true);
        }}
        onCycleMode={cycleExecutionMode}
        onFocusComposer={focusComposer}
        onMagicOpen={toggleMagicPalette}
      />
      {queuedGuidance.length > 0 ? (
        <div className="mb-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("issue.agent.queuedGuidance")}
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {queuedGuidance.map((entry, index) => (
              <li
                key={`${index}-${entry.text}`}
                className="flex items-start justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0 space-y-1">
                  {entry.text ? (
                    <span className="block whitespace-pre-wrap break-words text-foreground/90">{entry.text}</span>
                  ) : null}
                  {entry.attachments.length > 0 ? (
                    <span className="block text-muted-foreground">
                      {t("issue.agent.queuedAttachments", { count: entry.attachments.length })}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={t("issue.agent.removeQueuedAria")}
                  title={t("issue.agent.remove")}
                  disabled={controlsDisabled}
                  onClick={() => removeQueued(index)}
                  className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <AssistantComposer
          key={composerSeed.remountKey}
          projectSlug={projectSlug}
          bundle={bundle}
          floating
          slashContext="execution"
          slashCommandExtras={slashCommandExtras}
          magicPaletteOpen={magicOpen}
          onMagicPaletteOpenChange={setMagicOpen}
          magicIssueIdentifier={issue.identifier}
          onMagicRan={handleMagicRan}
          placeholder={composerPlaceholder}
          hint={null}
          seedMessage={seedMessage}
          resetToken={composerResetToken}
          composerDisabled={controlsDisabled || (canSteer && (!sessionConnected || steerPending))}
          agentMenuDisabled={controlsDisabled || agentRunActive}
          allowEmptySubmit={!canSteer && !agentRunActive && canResume}
          canSubmit={sendDisabled ? false : undefined}
          mentionsEnabled
          mentionOptions={mentionOptions}
          onMentionQueryChange={setMentionQuery}
          onMentionSelect={rememberMention}
          header={goalPill}
          onComposerSnapshot={(snapshot) => {
            composerSnapshotRef.current = snapshot;
          }}
          onEmptySubmit={handleEmptySubmit}
          onSubmit={handleComposerSubmit}
          onAgentChange={handleAgentChange}
          onSettingsChange={handleSettingsChange}
          agentSeed={composerSeed.agent}
          settingsSeed={settingsSeed}
          persistLocalComposerState={false}
          toolbarAfterAttach={
            <>
              <GitDiffLauncher
                projectSlug={projectSlug}
                identifier={issue.identifier}
                disabled={controlsDisabled}
                onSendReview={(review) => void runDispatch("resume", { instructions: review })}
              />
              <ExecutionModeMenu
                agent={agent}
                mode={mode}
                disabled={controlsDisabled}
                onChange={setMode}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                disabled={controlsDisabled}
                title={t("commands.magic.open")}
                onClick={toggleMagicPalette}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("commands.magic.button")}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                disabled={controlsDisabled}
                title={t("issue.agent.newThreadTitle")}
                onClick={() => {
                  setNewThreadInstructions(null);
                  setHardResetOpen(true);
                }}
              >
                <Eraser className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {dispatchPending === "hard_reset" ? t("issue.agent.resetting") : t("issue.agent.newThread")}
                </span>
              </Button>
            </>
          }
          submitActions={
            <>
              <span className="hidden text-xs text-muted-foreground lg:inline">
                {steerPending ? t("issue.agent.sendingSteer") : agentEnterHintLabel(enterIntent, t)}
              </span>
              {agentRunActive ? (
                <Button type="submit" size="sm" variant="default" disabled={sendDisabled} className="h-8 gap-1">
                  <Send className="h-3.5 w-3.5" />
                  {canSteer ? t("issue.agent.steer") : t("issue.agent.queue")}
                </Button>
              ) : null}
              {agentRunActive ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={controlsDisabled}
                  title={t("issue.agent.stopTitle")}
                  onClick={() => void runDispatch("stop")}
                >
                  <Square className="h-3.5 w-3.5" />
                  {dispatchPending === "stop" ? t("issue.agent.dispatchStop") : t("issue.agent.primaryStop")}
                </Button>
              ) : (
                <Button type="submit" size="sm" variant="secondary" className="h-8 gap-1" disabled={primaryDisabled}>
                  <Play className="h-3.5 w-3.5" />
                  {dispatchPending === "resume"
                    ? control.primaryAction === "start"
                      ? t("issue.agent.starting")
                      : t("issue.agent.resuming")
                    : primaryLabel}
                </Button>
              )}
            </>
          }
          footer={
            <div className="mt-2 space-y-1">
              {dispatchError ? <p className="text-xs text-destructive">{dispatchError}</p> : null}
              {dispatchStatus ? <p className="text-xs text-muted-foreground">{dispatchStatus}</p> : null}
              {steerError ? (
                <p className="text-xs text-destructive">{formatSteerError(steerError, t)}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("assistant.composer.hint", { command: catalogFor(bundle, agent).command })}
              </p>
            </div>
          }
        />
      </div>

      <Dialog
        open={hardResetOpen}
        onOpenChange={(open) => {
          setHardResetOpen(open);
          if (!open) setNewThreadInstructions(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("issue.agent.newThreadDialogTitle")}</DialogTitle>
            <DialogDescription>{t("issue.agent.newThreadDialogDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                {t("issue.agent.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={dispatchPending !== null}
              onClick={() => {
                setHardResetOpen(false);
                void runDispatch("hard_reset", { instructions: newThreadInstructions });
                setNewThreadInstructions(null);
              }}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" />
              {t("issue.agent.newThread")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function formatSteerError(reason: string, t: (key: string) => string): string {
  if (reason === "ActiveTurnNotSteerable") {
    return t("issue.agent.steerNotAvailable");
  }
  if (reason === "orchestrator_unavailable") {
    return t("issue.agent.orchestratorUnavailable");
  }
  return reason;
}
