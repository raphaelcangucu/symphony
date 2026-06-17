import { Eraser, Pause, Play, RotateCcw, Send, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ModelMenu } from "@/components/assistant/ModelMenu";
import { parseSlashCommand } from "@/components/assistant/slashCommands";
import { AGENT_LABELS } from "@/components/shared/AgentChip";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  catalogFor,
  defaultComposerSettings,
  effortLabel,
  effortsForModel,
  fallbackCatalogBundle,
  loadComposerState,
  normalizeEffort,
  saveComposerState,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantComposerState,
  type AssistantEffort,
} from "@/lib/assistantSettings";
import { agentEnterHintLabel, deriveAgentControl } from "@/lib/agentExecutionDisplay";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";

interface ExecutionControlComposerProps {
  projectSlug: string;
  issue: Issue;
  execution?: AgentExecution;
  sessionConnected?: boolean;
  canSteer?: boolean;
  steerPending?: boolean;
  steerError?: string | null;
  seedMessage?: string | null;
  onSteer: (message: string) => void;
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
  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string[]>([]);
  const [bundle, setBundle] = useState<AssistantCatalogBundle>(fallbackCatalogBundle());
  const [composerState, setComposerState] = useState<AssistantComposerState>(() => loadComposerState(fallbackCatalogBundle()));
  const [goalMode, setGoalMode] = useState(() => execution?.goal?.kind === "goal");
  const [dispatchPending, setDispatchPending] = useState<"resume" | "restart" | "hard_reset" | "stop" | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [hardResetOpen, setHardResetOpen] = useState(false);

  const agent: AgentKind = composerState.agent;
  const catalog = catalogFor(bundle, agent);
  const settings: AssistantComposerSettings =
    composerState.byAgent[agent] ?? defaultComposerSettings(catalog);
  const effortOptions = effortsForModel(catalog, settings.model);

  const trimmedGoalObjective = execution?.goal?.objective?.trim();
  const goalObjective = trimmedGoalObjective ? trimmedGoalObjective : null;

  const control = deriveAgentControl(execution, t);
  const agentRunActive = control.isActive;
  const canResume = control.canResume;
  const canRestart = control.canResume;
  // `canSteer` (prop) is the authoritative steer gate from the parent; the rest
  // of the lifecycle (pause/resume/start, labels) comes from the execution.
  const enterIntent = canSteer
    ? "steer"
    : control.isActive
      ? "queue"
      : control.hasRun
        ? "resume"
        : "start";
  const primaryLabel = control.primaryLabel;
  const queuedGuidance = useMemo(
    () => queued.filter((entry) => entry.trim().length > 0),
    [queued],
  );

  useEffect(() => {
    if (!seedMessage?.trim()) return;
    setInput(seedMessage);
  }, [seedMessage]);

  useEffect(() => {
    let cancelled = false;
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (cancelled) return;
        setBundle(next);
        setComposerState(loadComposerState(next));
      })
      .catch(() => {
        if (cancelled) return;
        setBundle(fallbackCatalogBundle());
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  useEffect(() => {
    if (issue.agentKind) {
      setComposerState((current) => ({ ...current, agent: issue.agentKind! }));
    }
  }, [issue.agentKind]);

  const persistComposer = useCallback(
    (next: AssistantComposerState) => {
      setComposerState(next);
      saveComposerState(next);
    },
    [],
  );

  const setAgent = useCallback(
    (nextAgent: AgentKind) => {
      persistComposer({ ...composerState, agent: nextAgent });
    },
    [composerState, persistComposer],
  );

  const setModel = useCallback(
    (model: string) => {
      const nextCatalog = catalogFor(bundle, agent);
      const modelOption = nextCatalog.models.find((entry) => entry.model === model) ?? nextCatalog.models[0];
      if (!modelOption) return;
      const effort = normalizeEffort(modelOption, settings.effort);
      persistComposer({
        ...composerState,
        byAgent: {
          ...composerState.byAgent,
          [agent]: { model: modelOption.model, effort },
        },
      });
    },
    [agent, bundle, composerState, persistComposer, settings.effort],
  );

  const setEffort = useCallback(
    (effort: AssistantEffort) => {
      persistComposer({
        ...composerState,
        byAgent: {
          ...composerState.byAgent,
          [agent]: { ...settings, effort },
        },
      });
    },
    [agent, composerState, persistComposer, settings],
  );

  const dispatchProgressLabel: Record<"resume" | "restart" | "hard_reset" | "stop", string> = {
    resume: t("issue.agent.dispatchResume"),
    restart: t("issue.agent.dispatchRestart"),
    hard_reset: t("issue.agent.dispatchHardReset"),
    stop: t("issue.agent.dispatchStop"),
  };

  // Guidance the agent should receive on the next resume/restart: anything the
  // user queued while the run was busy, plus whatever is currently typed.
  function combinedGuidance(): string {
    const parsed = parseSlashCommand(input);
    const typed = parsed.kind === "infer" ? parsed.argument.trim() : input.trim();
    return [...queuedGuidance, typed].filter((entry) => entry.length > 0).join("\n\n");
  }

  function enqueueGuidance() {
    const parsed = parseSlashCommand(input);
    const text = parsed.kind === "infer" ? parsed.argument.trim() : input.trim();
    if (!text) return;
    setQueued((current) => [...current, text]);
    setInput("");
  }

  function removeQueued(index: number) {
    setQueued((current) => current.filter((_, i) => i !== index));
  }

  async function runDispatch(action: "resume" | "restart" | "hard_reset" | "stop") {
    setDispatchPending(action);
    setDispatchError(null);
    setDispatchStatus(dispatchProgressLabel[action]);

    // Pausing keeps the typed/queued guidance around for the next resume.
    const guidance = action === "stop" ? "" : combinedGuidance();

    try {
      const result = await dispatchIssueAgent(projectSlug, issue.identifier, {
        action,
        agent,
        goal: goalMode ? goalObjective : null,
        instructions: guidance || null,
      });
      onIssueUpdated?.(result.issue);
      setDispatchStatus(result.message);
      if (action !== "stop") {
        setInput("");
        setQueued([]);
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

  function submitSteer() {
    const parsed = parseSlashCommand(input);
    const text = parsed.kind === "infer" ? parsed.argument.trim() : input.trim();
    if (!text) return;
    onSteer(text);
    setInput("");
  }

  // Single entry point for Enter / the send button: steer a live turn, queue
  // guidance for a busy-but-not-steerable run, or resume/start when stopped.
  function submitComposer() {
    if (canSteer) {
      submitSteer();
      return;
    }
    if (control.isActive) {
      enqueueGuidance();
      return;
    }
    if (canResume && !dispatchPending) void runDispatch("resume");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitComposer();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitComposer();
  }

  const controlsDisabled = dispatchPending !== null;
  const sendDisabled =
    controlsDisabled ||
    !input.trim() ||
    (canSteer && (!sessionConnected || steerPending));
  const primaryDisabled = controlsDisabled || (!agentRunActive && !canResume);

  return (
    <section className="rounded-xl border border-border/70 bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.agent.controlTitle")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {canSteer
              ? t("issue.agent.hintSteer")
              : agentRunActive
                ? t("issue.agent.hintBusy")
                : control.hasRun
                  ? t("issue.agent.hintResume")
                  : t("issue.agent.hintStart")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <AgentMenu bundle={bundle} agent={agent} disabled={controlsDisabled || agentRunActive} onChange={setAgent} />
          <ModelMenu
            catalog={catalog}
            model={settings.model}
            disabled={controlsDisabled}
            onChange={setModel}
            triggerVariant="outline"
            showChevron={false}
          />
          <EffortMenu
            catalog={catalog}
            model={settings.model}
            effort={settings.effort}
            options={effortOptions}
            disabled={controlsDisabled}
            onChange={setEffort}
          />
        </div>
      </div>

      {goalObjective ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {execution?.goal?.kind === "workflow"
                  ? t("issue.agent.workflowObjective")
                  : t("issue.agent.goalObjective")}
              </span>
              <span className="mt-1 block whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {goalObjective}
              </span>
            </span>
            <input
              type="checkbox"
              checked={goalMode}
              disabled={controlsDisabled}
              aria-label={t("issue.agent.sendGoalAria")}
              onChange={(event) => setGoalMode(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
          </label>
        </div>
      ) : null}

      {queuedGuidance.length > 0 ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("issue.agent.queuedGuidance")}
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {queuedGuidance.map((entry, index) => (
              <li
                key={`${index}-${entry}`}
                className="flex items-start justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 whitespace-pre-wrap break-words text-foreground/90">{entry}</span>
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

      <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            canSteer
              ? t("issue.agent.placeholderSteer")
              : agentRunActive
                ? t("issue.agent.placeholderQueue")
                : control.hasRun
                  ? t("issue.agent.placeholderResume")
                  : t("issue.agent.placeholderStart")
          }
          disabled={controlsDisabled || (canSteer && (!sessionConnected || steerPending))}
          rows={3}
          className="min-h-0 resize-none text-sm"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canRestart || controlsDisabled}
              title={
                canRestart ? t("issue.agent.restartTitle") : t("issue.agent.restartPauseFirst")
              }
              onClick={() => void runDispatch("restart")}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {dispatchPending === "restart" ? t("issue.agent.restarting") : t("issue.agent.restart")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={controlsDisabled}
              title={t("issue.agent.hardResetTitle")}
              onClick={() => setHardResetOpen(true)}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" />
              {dispatchPending === "hard_reset" ? t("issue.agent.resetting") : t("issue.agent.hardReset")}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {steerPending ? t("issue.agent.sendingSteer") : agentEnterHintLabel(enterIntent, t)}
            </span>
            {agentRunActive ? (
              <Button type="submit" size="sm" variant="default" disabled={sendDisabled}>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {canSteer ? t("issue.agent.steer") : t("issue.agent.queue")}
              </Button>
            ) : null}
            {agentRunActive ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={controlsDisabled}
                title={t("issue.agent.pauseTitle")}
                onClick={() => void runDispatch("stop")}
              >
                <Pause className="mr-1.5 h-3.5 w-3.5" />
                {dispatchPending === "stop" ? t("issue.agent.dispatchStop") : t("issue.agent.primaryPause")}
              </Button>
            ) : (
              <Button type="submit" size="sm" variant="secondary" disabled={primaryDisabled}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {dispatchPending === "resume"
                  ? control.primaryAction === "start"
                    ? t("issue.agent.starting")
                    : t("issue.agent.resuming")
                  : primaryLabel}
              </Button>
            )}
          </div>
        </div>

        {dispatchError ? <p className="text-xs text-destructive">{dispatchError}</p> : null}
        {dispatchStatus ? <p className="text-xs text-muted-foreground">{dispatchStatus}</p> : null}
        {steerError ? (
          <p className="text-xs text-destructive">{formatSteerError(steerError, t)}</p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {t("issue.agent.modelsHint", { command: catalog.command, agent: AGENT_LABELS[agent] })}
        </p>
      </form>

      <Dialog open={hardResetOpen} onOpenChange={setHardResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("issue.agent.hardResetDialogTitle")}</DialogTitle>
            <DialogDescription>{t("issue.agent.hardResetDialogDescription")}</DialogDescription>
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
                void runDispatch("hard_reset");
              }}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" />
              {t("issue.agent.hardReset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AgentMenu({
  bundle,
  agent,
  disabled,
  onChange,
}: {
  bundle: AssistantCatalogBundle;
  agent: AgentKind;
  disabled?: boolean;
  onChange: (agent: AgentKind) => void;
}) {
  const { t } = useTranslation();
  const current = catalogFor(bundle, agent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {current.agentLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("issue.agent.agentMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={agent} onValueChange={(value) => onChange(value as AgentKind)}>
          {bundle.agents.map((entry) => (
            <DropdownMenuRadioItem key={entry.agent} value={entry.agent}>
              {entry.agentLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortMenu({
  catalog,
  model,
  effort,
  options,
  disabled,
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  effort: AssistantEffort;
  options: ReturnType<typeof effortsForModel>;
  disabled?: boolean;
  onChange: (effort: AssistantEffort) => void;
}) {
  if (options.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortLabel(catalog, model, effort)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={effort} onValueChange={(value) => onChange(value as AssistantEffort)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
