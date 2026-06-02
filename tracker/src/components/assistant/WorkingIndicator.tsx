import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const WORKING_VERBS = [
  "Pondering",
  "Cooking",
  "Wrangling tokens",
  "Consulting the codex",
  "Untangling threads",
  "Spelunking the repo",
  "Composing",
  "Crunching",
  "Plotting",
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function WorkingIndicator({ startedAt, activeTool }: WorkingIndicatorProps) {
  const reducedMotion = useRef(prefersReducedMotion());
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (reducedMotion.current) return;
    const id = window.setInterval(
      () => setVerbIndex((current) => (current + 1) % WORKING_VERBS.length),
      VERB_ROTATION_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const label = activeTool ? `Running ${activeTool}` : WORKING_VERBS[verbIndex];

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
      <span className="tabular-nums text-xs opacity-70">· {formatElapsed(elapsedMs)}</span>
    </div>
  );
}
