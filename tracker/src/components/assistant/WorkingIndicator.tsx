import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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

interface WorkingIndicatorProps {
  startedAt: number;
  activeTool?: string | null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}


export function WorkingIndicator({ startedAt, activeTool }: WorkingIndicatorProps) {
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

  const label = activeTool
    ? t("assistant.working.runningTool", { tool: activeTool })
    : t(WORKING_VERB_KEYS[verbIndex]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2
        aria-hidden="true"
        className={cn("h-3.5 w-3.5", reducedMotion.current ? "opacity-70" : "animate-spin")}
      />
      <span>{label}…</span>
      <span className="tabular-nums text-xs opacity-70">· {formatClockElapsed(elapsedMs)}</span>
    </div>
  );
}
