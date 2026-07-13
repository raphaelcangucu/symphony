import { Check, Clock, Loader2, Pause, Pencil, Play, Square, Target, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useNowTick } from "@/hooks/useNowTick";
import { formatGoalClock } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";

export type GoalPillPhase =
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "blocked"
  | "failed"
  | "budgetLimited"
  | "usageLimited"
  | "active"
  | "stalled"
  | "resumable"
  | "pending";

export type GoalPillProvider = "codex" | "claude" | "unsupported";

export { formatGoalClock } from "@/lib/timeFormat";

/**
 * Codex-style goal indicator docked above a composer. Shared by the authoring
 * assistant and the execution control composer so both surfaces expose the
 * same pause/resume/edit/remove affordances.
 */
export function GoalPill({
  phase,
  provider,
  capabilities,
  objective,
  running,
  timeUsedSeconds,
  onStop,
  onPause,
  onResume,
  onRemove,
  onEditObjective,
}: {
  phase: GoalPillPhase;
  provider?: GoalPillProvider | null;
  capabilities?: readonly string[];
  objective: string | null;
  running: boolean;
  timeUsedSeconds: number | null;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRemove?: () => void;
  onEditObjective?: (objective: string) => void;
}) {
  const { t } = useTranslation();
  const trimmed = objective?.trim() || null;
  const allowedCapabilities = capabilities ?? [];
  const canPause = running && allowedCapabilities.includes("pause") && onPause != null;
  const canResume =
    !running &&
    (phase === "paused" || phase === "resumable") &&
    allowedCapabilities.includes("resume") &&
    onResume != null;
  const canEdit =
    !running &&
    (allowedCapabilities.includes("edit") || allowedCapabilities.includes("set_objective")) &&
    onEditObjective != null;
  const canRemove = allowedCapabilities.includes("clear") && onRemove != null;
  const canStop = running && allowedCapabilities.includes("stop") && onStop != null;

  const tick = useNowTick(1000, { enabled: running });
  const runStartRef = useRef<number | null>(null);
  const baseRef = useRef<number>(timeUsedSeconds ?? 0);

  useEffect(() => {
    if (running) {
      if (runStartRef.current == null) {
        runStartRef.current = Date.now();
        baseRef.current = timeUsedSeconds ?? baseRef.current;
      }
    } else {
      runStartRef.current = null;
      baseRef.current = timeUsedSeconds ?? baseRef.current;
    }
  }, [running, timeUsedSeconds]);

  const elapsedSeconds =
    running && runStartRef.current != null
      ? baseRef.current + (tick - runStartRef.current) / 1000
      : timeUsedSeconds;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmed ?? "");

  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  const label = goalPhaseLabel(phase, t);
  const providerLabel = provider
    ? provider === "codex"
      ? t("assistant.goalDock.providerCodex")
      : provider === "claude"
        ? t("assistant.goalDock.providerClaude")
        : t("assistant.goalDock.providerUnsupported")
    : null;
  const objectiveLabel = trimmed || t("assistant.goalDock.noObjective");

  const dotClass =
    phase === "running"
      ? "bg-emerald-400"
      : phase === "paused"
        ? "bg-amber-400"
        : phase === "completed"
          ? "bg-sky-400"
          : phase === "starting" || phase === "pending" || phase === "active"
            ? "bg-slate-400"
            : phase === "resumable"
              ? "bg-violet-400"
              : phase === "failed" || phase === "usageLimited" || phase === "budgetLimited"
                ? "bg-red-400"
                : "bg-orange-400";

  function commitEdit() {
    const next = draft.trim();
    if (next.length > 0 && next !== trimmed) onEditObjective?.(next);
    setEditing(false);
  }

  return (
    <div
      role="region"
      aria-label={t("assistant.goalDock.ariaLabel")}
      className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs"
    >
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {[label, providerLabel, objectiveLabel].filter(Boolean).join(". ")}
      </span>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-violet-500"
        >
          {phase === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
        </span>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden />
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        {providerLabel ? (
          <span className="shrink-0 rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {providerLabel}
          </span>
        ) : null}

        {editing ? null : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={trimmed || undefined}>
            {objectiveLabel}
          </span>
        )}

        {editing ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {elapsedSeconds != null ? (
              <span aria-hidden className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatGoalClock(elapsedSeconds)}
              </span>
            ) : null}

            {canStop ? (
              <GoalPillButton label={t("assistant.goalDock.stop")} onClick={onStop}>
                <Square className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : null}

            {canPause ? (
              <GoalPillButton label={t("assistant.goalDock.pause")} onClick={onPause}>
                <Pause className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : canResume ? (
              <GoalPillButton label={t("assistant.goalDock.resume")} onClick={onResume}>
                <Play className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : null}

            {canEdit ? (
              <GoalPillButton
                label={t("assistant.goalDock.edit")}
                onClick={() => {
                  setDraft(trimmed ?? "");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : null}

            {canRemove ? (
              <GoalPillButton label={t("assistant.goalDock.remove")} onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : null}
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2 flex items-start gap-2">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commitEdit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            placeholder={t("assistant.goalDock.objectivePlaceholder")}
            className="min-h-0 flex-1 resize-none rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex shrink-0 flex-col gap-1">
            <GoalPillButton label={t("assistant.goalDock.editSave")} onClick={commitEdit}>
              <Check className="h-3.5 w-3.5" />
            </GoalPillButton>
            <GoalPillButton label={t("assistant.goalDock.editCancel")} onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5" />
            </GoalPillButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function goalPhaseLabel(phase: GoalPillPhase, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (phase) {
    case "starting":
      return t("assistant.goalDock.starting");
    case "running":
      return t("assistant.goalDock.running");
    case "paused":
      return t("assistant.goalDock.paused");
    case "completed":
      return t("assistant.goalDock.completed");
    case "blocked":
      return t("assistant.goalDock.blocked");
    case "failed":
      return t("assistant.goalDock.failed");
    case "budgetLimited":
      return t("assistant.goalDock.budgetLimited");
    case "usageLimited":
      return t("assistant.goalDock.usageLimited");
    case "active":
      return t("assistant.goalDock.active");
    case "resumable":
      return t("assistant.goalDock.resumable");
    case "pending":
      return t("assistant.goalDock.pending");
    case "stalled":
      return t("assistant.goalDock.stalled");
  }
}

function GoalPillButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      {children}
    </button>
  );
}
