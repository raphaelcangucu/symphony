import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useNowTick } from "@/hooks/useNowTick";
import { formatClockElapsed } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";

const WORKING_VERB_KEYS = [
  "assistant.working.verbs.pondering",
  "assistant.working.verbs.cooking",
  "assistant.working.verbs.wrangling",
  "assistant.working.verbs.consulting",
  "assistant.working.verbs.untangling",
  "assistant.working.verbs.spelunking",
  "assistant.working.verbs.composing",
  "assistant.working.verbs.crunching",
  "assistant.working.verbs.plotting",
] as const;

const VERB_ROTATION_MS = 3000;
const COMMAND_SUMMARY_MAX = 80;

export interface WorkingActiveToolDetail {
  id: string;
  name: string;
  argumentsSummary: string | null;
  startedAt?: number | null;
}

interface WorkingIndicatorProps {
  startedAt: number;
  /** @deprecated Prefer `activeToolDetail` for command + Kill. */
  activeTool?: string | null;
  activeToolDetail?: WorkingActiveToolDetail | null;
  stale?: boolean;
  onStop?: () => void;
  onKill?: (toolCallId: string) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function truncateSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= COMMAND_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, COMMAND_SUMMARY_MAX - 1)}…`;
}

export function WorkingIndicator({
  startedAt,
  activeTool = null,
  activeToolDetail = null,
  stale = false,
  onStop,
  onKill,
}: WorkingIndicatorProps) {
  const { t } = useTranslation();
  const reducedMotion = useRef(prefersReducedMotion());
  const nowMs = useNowTick(1000);
  const elapsedMs = nowMs - startedAt;
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion.current) return;
    const id = window.setInterval(
      () => setVerbIndex((current) => (current + 1) % WORKING_VERB_KEYS.length),
      VERB_ROTATION_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const detail = activeToolDetail;
  const toolName = detail?.name ?? activeTool;
  const summary = detail?.argumentsSummary
    ? truncateSummary(detail.argumentsSummary)
    : null;

  const label = toolName
    ? summary
      ? t("assistant.working.runningToolWithCommand", {
          tool: toolName,
          command: summary,
        })
      : t("assistant.working.runningTool", { tool: toolName })
    : t(WORKING_VERB_KEYS[verbIndex]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5",
          reducedMotion.current ? "opacity-70" : "animate-spin",
        )}
      />
      <span className="min-w-0 break-all">
        {label}…
        {stale ? (
          <span className="ml-1 text-xs opacity-80">
            {t("assistant.working.staleHint")}
          </span>
        ) : null}
      </span>
      <span className="tabular-nums text-xs opacity-70">
        · {formatClockElapsed(elapsedMs)}
      </span>
      {onStop || (onKill && detail?.id) ? (
        <span className="ml-auto flex items-center gap-1">
          {onKill && detail?.id ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onKill(detail.id)}
            >
              {t("assistant.working.kill")}
            </Button>
          ) : null}
          {onStop ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onStop}
            >
              {t("assistant.working.stop")}
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
