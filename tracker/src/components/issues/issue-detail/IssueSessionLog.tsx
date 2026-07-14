import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AgentTaskPinnedPanel,
  SessionLogTranscript,
} from "@/components/agent-activity";
import { Button } from "@/components/ui/button";
import { deriveAgentTasks } from "@/lib/agentTasks";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { SessionLogEntry } from "@/types/session-log";

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

interface IssueSessionLogProps {
  issueIdentifier: string;
  connected: boolean;
  entries: SessionLogEntry[];
  error: string | null;
  logAgentKind?: string | null;
  preferredAgentKind?: string | null;
  /**
   * `standalone` owns its scroller (tests / embedded callers).
   * `shell-feed` renders transcript only — parent `AssistantSessionShell` scrolls.
   */
  variant?: "standalone" | "shell-feed";
  /** @deprecated Prefer `variant="shell-feed"` inside AssistantSessionShell. */
  fill?: boolean;
}

export function IssueSessionLog({
  issueIdentifier,
  entries,
  error,
  variant,
  fill = false,
}: IssueSessionLogProps) {
  const { t } = useTranslation();
  const resolvedVariant = variant ?? (fill ? "shell-feed" : "standalone");
  const isShellFeed = resolvedVariant === "shell-feed";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const taskSnapshot = deriveAgentTasks(entries);

  useEffect(() => {
    if (isShellFeed) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const updateStickiness = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
      stickToBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    updateStickiness();
    container.addEventListener("scroll", updateStickiness, { passive: true });
    return () => container.removeEventListener("scroll", updateStickiness);
  }, [isShellFeed]);

  useEffect(() => {
    if (isShellFeed) return;
    const container = containerRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [entries, isShellFeed]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  const transcript = error ? (
    <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  ) : entries.length > 0 ? (
    <SessionLogTranscript entries={entries} taskSnapshot={taskSnapshot} />
  ) : (
    <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("issue.sessionLog.waiting")}</p>
  );

  if (isShellFeed) {
    return (
      <section
        aria-label={t("issue.sessionLog.chatHistoryAriaLabel", { identifier: issueIdentifier })}
        className="flex min-h-0 flex-col gap-3"
      >
        <AgentTaskPinnedPanel snapshot={taskSnapshot} />
        <div className="space-y-4">{transcript}</div>
      </section>
    );
  }

  return (
    <section className="relative min-h-0">
      <AgentTaskPinnedPanel snapshot={taskSnapshot} />
      <div
        ref={containerRef}
        aria-label={t("issue.sessionLog.chatHistoryAriaLabel", { identifier: issueIdentifier })}
        className={cn("max-h-[520px] space-y-4 overflow-auto px-1 py-2", SCROLLBAR_THIN)}
      >
        {transcript}
      </div>
      {!error && entries.length > 0 && !isAtBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={t("issue.sessionLog.scrollToBottom")}
            title={t("issue.sessionLog.scrollToBottom")}
            onClick={scrollToBottom}
            className="pointer-events-auto h-8 w-8 rounded-full border bg-background/95 shadow-md backdrop-blur-sm"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
