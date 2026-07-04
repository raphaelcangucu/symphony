import { Check, Clock, Loader2, Pause, Pencil, Play, Target, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type GoalPillPhase = "running" | "paused" | "stalled" | "completed" | "pending";

export function formatGoalClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Codex-style goal indicator docked above a composer. Shared by the authoring
 * assistant and the execution control composer so both surfaces expose the
 * same pause/resume/edit/remove affordances.
 */
export function GoalPill({
  phase,
  objective,
  running,
  timeUsedSeconds,
  onPause,
  onResume,
  onRemove,
  onEditObjective,
}: {
  phase: GoalPillPhase;
  objective: string | null;
  running: boolean;
  timeUsedSeconds: number | null;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
  onEditObjective: (objective: string) => void;
}) {
  const { t } = useTranslation();
  const trimmed = objective?.trim() || null;

  const [tick, setTick] = useState(() => Date.now());
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

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedSeconds =
    running && runStartRef.current != null
      ? baseRef.current + (tick - runStartRef.current) / 1000
      : timeUsedSeconds;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmed ?? "");

  const label =
    phase === "running"
      ? t("assistant.authoring.goalRunning")
      : phase === "paused"
        ? t("assistant.authoring.goalPaused")
        : phase === "completed"
          ? t("assistant.authoring.goalCompleted")
          : phase === "pending"
            ? t("assistant.authoring.goalPending")
            : t("assistant.authoring.goalStalled");

  const dotClass =
    phase === "running"
      ? "bg-emerald-400"
      : phase === "paused"
        ? "bg-amber-400"
        : phase === "completed"
          ? "bg-sky-400"
          : phase === "pending"
            ? "bg-slate-400"
            : "bg-orange-400";

  function commitEdit() {
    const next = draft.trim();
    if (next.length > 0 && next !== trimmed) onEditObjective(next);
    setEditing(false);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("assistant.authoring.goalBannerAria")}
      className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-violet-500">
          {phase === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
        </span>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden />
        <span className="shrink-0 font-medium text-foreground">{label}</span>

        {editing ? null : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={trimmed || undefined}>
            {trimmed || t("assistant.authoring.goalNoObjective")}
          </span>
        )}

        {editing ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {elapsedSeconds != null ? (
              <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatGoalClock(elapsedSeconds)}
              </span>
            ) : null}

            {phase === "running" ? (
              <GoalPillButton label={t("assistant.authoring.goalPause")} onClick={onPause}>
                <Pause className="h-3.5 w-3.5" />
              </GoalPillButton>
            ) : (
              <GoalPillButton label={t("assistant.authoring.goalResume")} onClick={onResume}>
                <Play className="h-3.5 w-3.5" />
              </GoalPillButton>
            )}

            <GoalPillButton
              label={t("assistant.authoring.goalEdit")}
              onClick={() => {
                setDraft(trimmed ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </GoalPillButton>

            <GoalPillButton label={t("assistant.authoring.goalRemove")} onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </GoalPillButton>
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
            placeholder={t("assistant.authoring.goalObjectivePlaceholder")}
            className="min-h-0 flex-1 resize-none rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex shrink-0 flex-col gap-1">
            <GoalPillButton label={t("assistant.authoring.goalEditSave")} onClick={commitEdit}>
              <Check className="h-3.5 w-3.5" />
            </GoalPillButton>
            <GoalPillButton label={t("assistant.authoring.goalEditCancel")} onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5" />
            </GoalPillButton>
          </div>
        </div>
      ) : null}
    </div>
  );
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
