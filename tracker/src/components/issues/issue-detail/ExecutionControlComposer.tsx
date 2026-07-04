import { Eraser, Pause, Play, Send, Sparkles, X } from "lucide-react";
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
import {
  expandComposerMentions,
  parseMentionTokens,
  type ResolvedMention,
} from "@/components/assistant/contextMentions";
import { useContextMentionData } from "@/components/assistant/useContextMentionData";
import { defaultSkillCommands, parseSlashCommand } from "@/components/assistant/slashCommands";
import { MagicCommandPalette } from "@/components/commands/MagicCommandPalette";
import { ExecutionCommandPalette } from "@/components/issues/issue-detail/ExecutionCommandPalette";
import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { GoalPill, type GoalPillPhase } from "@/components/shared/GoalPill";
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
import { agentEnterHintLabel, canResumeExecution, deriveAgentControl } from "@/lib/agentExecutionDisplay";
import { enrichGuidanceWithAttachments } from "@/lib/enrichComposerGuidance";
import { catalogFor, fallbackCatalogBundle } from "@/lib/assistantSettings";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import { dispatchIssueAgent } from "@/services/issueDispatch";
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
  // Cache resolved entities by token so dispatched instructions can expand the
  // inline `@type:id` tokens into a `## Context` block, even across re-renders.
  const resolvedMentionsRef = useRef<Map<string, ResolvedMention>>(new Map());

  const rememberMention = useCallback((entity: ResolvedMention) => {
    resolvedMentionsRef.current.set(`${entity.type}:${entity.id}`, entity);
  }, []);

  const expandMentions = useCallback((text: string): string => {
    const tokens = parseMentionTokens(text);
    if (tokens.length === 0) return text;
    const resolved = tokens.map(
      (token) => resolvedMentionsRef.current.get(`${token.type}:${token.id}`) ?? token,
    );
    return expandComposerMentions(text, resolved);
  }, []);

  // Codex goals are sourced solely from the live execution snapshot (the native
  // Codex thread), never from the cached issue.agentGoal column.
  const trimmedGoalObjective = execution?.goal?.objective?.trim() || "";
  const goalObjective = trimmedGoalObjective.length > 0 ? trimmedGoalObjective : null;
  const showGoalPill = !goalDismissed && goalObjective != null;

  useEffect(() => {
    if (!goalObjective) setGoalDismissed(false);
  }, [goalObjective]);

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

  useEffect(() => {
    if (issue.agentKind) setAgent(issue.agentKind);
  }, [issue.agentKind]);

  // Keep the selected mode valid for the active agent (cursor has no plan mode).
  useEffect(() => {
    const available = availableModesFor(agent);
    setMode((current) => (available.includes(current) ? current : available[0]));
  }, [agent]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const dispatchProgressLabel: Record<"resume" | "hard_reset" | "stop", string> = {
    resume: t("issue.agent.dispatchResume"),
    hard_reset: t("issue.agent.dispatchHardReset"),
    stop: t("issue.agent.dispatchStop"),
  };

  function guidanceFromQueued(entry: QueuedGuidanceItem): string {
    return enrichGuidanceWithAttachments(entry.text, entry.attachments, projectSlug, entry.fileTexts);
  }

  function guidanceFromSnapshot(snapshot: ComposerSnapshot): string {
    const parsed = parseSlashCommand(snapshot.input, t, "execution");
    const typed = parsed.kind === "message" ? snapshot.input.trim() : parsed.argument.trim();
    return enrichGuidanceWithAttachments(expandMentions(typed), snapshot.attachments, projectSlug, {});
  }

  function combinedGuidance(): string {
    const parts = [
      ...queuedGuidance.map((entry) => guidanceFromQueued(entry)),
      guidanceFromSnapshot(composerSnapshotRef.current),
    ].filter((entry) => entry.length > 0);
    return parts.join("\n\n");
  }

  function removeQueued(index: number) {
    setQueued((current) => current.filter((_, i) => i !== index));
  }

  async function runDispatch(
    action: "resume" | "hard_reset" | "stop",
    overrides?: { goal?: string | null; instructions?: string | null; contextRefs?: AssistantComposerSubmit["contextRefs"] },
  ) {
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
  }

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
      issue,
      onIssueUpdated,
      onSteer,
      projectSlug,
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

      if (canSteer) {
        if (!text && !hasAttachments && !hasContextRefs) return;
        onSteer({
          message: expanded,
          attachments: submit.attachments,
          ...(hasContextRefs ? { contextRefs: submit.contextRefs } : {}),
        });
        return;
      }

      if (control.isActive) {
        if (!text && !hasAttachments && !hasContextRefs) return;
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

      if (!dispatchPending) {
        const instructions = enrichGuidanceWithAttachments(expanded, submit.attachments, projectSlug, {});
        void runDispatch("resume", { instructions, contextRefs: submit.contextRefs });
      }
    },
    [canSteer, control.isActive, dispatchPending, expandMentions, onSteer, projectSlug, submitExecutionGoal],
  );

  const handleEmptySubmit = useCallback(() => {
    if (canSteer || control.isActive || dispatchPending) return;
    if (canResume) void runDispatch("resume");
  }, [canResume, canSteer, control.isActive, dispatchPending]);

  const sendDisabled =
    controlsDisabled || (canSteer && (!sessionConnected || steerPending));
  const primaryDisabled = controlsDisabled || (!agentRunActive && !canResume);

  const goalPhase = executionGoalPhase(agentRunActive, showGoalPill, execution);
  const goalTimeUsedSeconds =
    execution?.goal?.timeUsedSeconds ?? (agentRunActive ? execution?.runtimeSeconds : null) ?? null;
  const nativeGoal = execution?.goal?.source === "native" && execution?.goal?.kind === "goal";

  async function handleGoalPause() {
    if (nativeGoal && execution?.goal?.capabilities.includes("pause")) {
      try {
        await controlIssueGoal(projectSlug, issue.identifier, { action: "pause" });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
      }
      return;
    }
    if (agentRunActive) void runDispatch("stop");
  }

  async function handleGoalResume() {
    if (nativeGoal && execution?.goal?.capabilities.includes("resume") && !agentRunActive) {
      try {
        await controlIssueGoal(projectSlug, issue.identifier, { action: "resume" });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
      }
      return;
    }
    if (!agentRunActive && !dispatchPending) void runDispatch("resume");
  }

  async function handleGoalRemove() {
    try {
      await controlIssueGoal(projectSlug, issue.identifier, { action: "clear" });
      setGoalDismissed(true);
      toast.success(t("issue.agent.goalControls.clearDone"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    }
  }

  async function handleGoalEdit(objective: string) {
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
      objective={goalObjective}
      running={agentRunActive}
      timeUsedSeconds={goalTimeUsedSeconds}
      onPause={() => void handleGoalPause()}
      onResume={() => void handleGoalResume()}
      onRemove={() => void handleGoalRemove()}
      onEditObjective={(objective) => void handleGoalEdit(objective)}
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
      <MagicCommandPalette
        open={magicOpen}
        onOpenChange={setMagicOpen}
        projectSlug={projectSlug}
        identifier={issue.identifier}
        onRan={handleMagicRan}
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
          projectSlug={projectSlug}
          bundle={bundle}
          floating
          slashContext="execution"
          slashCommandExtras={slashCommandExtras}
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
          onAgentChange={setAgent}
          onSettingsChange={(_agent, next) => {
            composerSettingsRef.current = { model: next.model, effort: next.effort };
          }}
          toolbarAfterAttach={
            <>
              <GitDiffLauncher projectSlug={projectSlug} identifier={issue.identifier} disabled={controlsDisabled} />
              <ExecutionModeMenu
                agent={agent}
                mode={mode}
                disabled={controlsDisabled || agentRunActive}
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
                  title={t("issue.agent.pauseTitle")}
                  onClick={() => void runDispatch("stop")}
                >
                  <Pause className="h-3.5 w-3.5" />
                  {dispatchPending === "stop" ? t("issue.agent.dispatchStop") : t("issue.agent.primaryPause")}
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

function executionGoalPhase(
  agentRunActive: boolean,
  hasGoal: boolean,
  execution?: AgentExecution,
): GoalPillPhase {
  if (agentRunActive) return "running";
  if (execution?.goal?.status === "paused") return "paused";
  if (
    execution?.goal?.status === "completed" ||
    execution?.goal?.status === "complete" ||
    execution?.goal?.status === "done" ||
    execution?.goal?.status === "satisfied"
  ) {
    return "completed";
  }
  if (execution && canResumeExecution(execution)) return "stalled";
  if (hasGoal) return "pending";
  return "pending";
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
