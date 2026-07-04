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
  /** Grow to fill the available height (chat layout) instead of a fixed max. */
  fill?: boolean;
}

export function IssueSessionLog({
  issueIdentifier,
  entries,
  error,
  fill = false,
}: IssueSessionLogProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const taskSnapshot = deriveAgentTasks(entries);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [entries]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  return (
    <section className={cn("relative min-h-0", fill && "flex flex-1 flex-col")}>
      <AgentTaskPinnedPanel snapshot={taskSnapshot} />
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : (
        <div
          ref={containerRef}
          aria-label={t("issue.sessionLog.chatHistoryAriaLabel", { identifier: issueIdentifier })}
          className={cn(
            "space-y-4 overflow-auto px-1 py-2",
            SCROLLBAR_THIN,
            fill ? "min-h-0 flex-1" : "max-h-[520px]",
          )}
        >
          {entries.length > 0 ? (
            <SessionLogTranscript entries={entries} taskSnapshot={taskSnapshot} />
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("issue.sessionLog.waiting")}</p>
          )}
        </div>
      )}
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
