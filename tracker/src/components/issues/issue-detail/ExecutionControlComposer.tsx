import { Play, RotateCcw, Send } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { parseSlashCommand } from "@/components/assistant/slashCommands";
import { AGENT_LABELS } from "@/components/shared/AgentChip";
import { Button } from "@/components/ui/button";
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
  modelLabel,
  normalizeEffort,
  saveComposerState,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantComposerState,
  type AssistantEffort,
} from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";
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
  const [input, setInput] = useState("");
  const [bundle, setBundle] = useState<AssistantCatalogBundle>(fallbackCatalogBundle());
  const [composerState, setComposerState] = useState<AssistantComposerState>(() => loadComposerState(fallbackCatalogBundle()));
  const [goalMode, setGoalMode] = useState(() => execution?.goal?.kind === "goal");
  const [dispatchPending, setDispatchPending] = useState<"resume" | "restart" | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const agent: AgentKind = composerState.agent;
  const catalog = catalogFor(bundle, agent);
  const settings: AssistantComposerSettings =
    composerState.byAgent[agent] ?? defaultComposerSettings(catalog);
  const effortOptions = effortsForModel(catalog, settings.model);

  const goalObjective = useMemo(() => {
    if (execution?.goal?.objective?.trim()) return execution.goal.objective.trim();
    return null;
  }, [execution?.goal?.objective]);

  const agentRunActive = execution?.status === "live" || execution?.status === "waiting" || execution?.status === "idle";
  const canResume = !agentRunActive;
  const canRestart = !agentRunActive;

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

  async function runDispatch(action: "resume" | "restart") {
    setDispatchPending(action);
    setDispatchError(null);
    setDispatchStatus(action === "resume" ? "Resuming agent…" : "Restarting agent…");

    const parsed = parseSlashCommand(input);
    const steerText = parsed.kind === "infer" ? parsed.argument.trim() : input.trim();

    try {
      const result = await dispatchIssueAgent(projectSlug, issue.identifier, {
        action,
        agent,
        goal: goalMode ? goalObjective : null,
        instructions: steerText || null,
      });
      onIssueUpdated?.(result.issue);
      setDispatchStatus(result.message);
      if (steerText) setInput("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Dispatch failed";
      setDispatchError(message);
      setDispatchStatus(null);
      toast.error(message);
    } finally {
      setDispatchPending(null);
    }
  }

  function submitSteer() {
    const parsed = parseSlashCommand(input);
    if (parsed.kind !== "infer" || !parsed.argument.trim()) return;
    onSteer(parsed.argument);
    setInput("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSteer) {
      submitSteer();
      return;
    }
    if (canResume) void runDispatch("resume");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSteer) {
      submitSteer();
      return;
    }
    if (canResume && !dispatchPending) void runDispatch("resume");
  }

  const controlsDisabled = dispatchPending !== null;

  return (
    <section className="rounded-xl border border-border/70 bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent control</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {canSteer
              ? "Steer the live run with /infer, or queue guidance for the next resume."
              : "Resume where the run stopped, restart fresh, or add guidance for the next dispatch."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <AgentMenu bundle={bundle} agent={agent} disabled={controlsDisabled || agentRunActive} onChange={setAgent} />
          <ModelMenu catalog={catalog} model={settings.model} disabled={controlsDisabled} onChange={setModel} />
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
                {execution?.goal?.kind === "workflow" ? "Workflow objective" : "Goal objective"}
              </span>
              <span className="mt-1 block whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {goalObjective}
              </span>
            </span>
            <input
              type="checkbox"
              checked={goalMode}
              disabled={controlsDisabled}
              aria-label="Send goal on resume or restart"
              onChange={(event) => setGoalMode(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
          </label>
        </div>
      ) : null}

      <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            canSteer
              ? "/infer focus on the failing test first"
              : "Optional guidance for resume/restart, or /infer while the agent is live"
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
              disabled={!canResume || controlsDisabled || !sessionConnected}
              title={
                !sessionConnected
                  ? "Connect to the session log first"
                  : canResume
                    ? "Resume from the current workspace and session log"
                    : "Stop the active run before resuming"
              }
              onClick={() => void runDispatch("resume")}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {dispatchPending === "resume" ? "Resuming…" : "Resume"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canRestart || controlsDisabled || !sessionConnected}
              title={
                !sessionConnected
                  ? "Connect to the session log first"
                  : canRestart
                    ? "Start a fresh agent pass on this issue"
                    : "Stop the active run before restarting"
              }
              onClick={() => void runDispatch("restart")}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {dispatchPending === "restart" ? "Restarting…" : "Restart"}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {steerPending ? "Sending steer…" : canSteer ? "Enter to steer" : "Enter to resume"}
            </span>
            <Button
              type="submit"
              size="sm"
              variant={canSteer ? "default" : "secondary"}
              disabled={
                controlsDisabled ||
                (canSteer && (!sessionConnected || steerPending || !input.trim())) ||
                (!canSteer && !canResume)
              }
            >
              {canSteer ? (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Steer
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume
                </>
              )}
            </Button>
          </div>
        </div>

        {dispatchError ? <p className="text-xs text-destructive">{dispatchError}</p> : null}
        {dispatchStatus ? <p className="text-xs text-muted-foreground">{dispatchStatus}</p> : null}
        {steerError ? <p className="text-xs text-destructive">{formatSteerError(steerError)}</p> : null}
        <p className="text-[11px] text-muted-foreground">
          Models from {catalog.command}. Agent selection applies on resume/restart; steer uses the live {AGENT_LABELS[agent]} session.
        </p>
      </form>
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
  const current = catalogFor(bundle, agent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {current.agentLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
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

function ModelMenu({
  catalog,
  model,
  disabled,
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("h-8 gap-1 px-2 text-xs")} disabled={disabled}>
          {modelLabel(catalog, model)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{catalog.agentLabel} · Model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={model} onValueChange={onChange}>
          {catalog.models.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.model}>
              {option.label}
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

function formatSteerError(reason: string): string {
  if (reason === "ActiveTurnNotSteerable") {
    return "No steerable agent turn is running — use Resume to pick the run back up.";
  }
  if (reason === "orchestrator_unavailable") {
    return "The orchestrator is unavailable; try again in a moment.";
  }
  return reason;
}
