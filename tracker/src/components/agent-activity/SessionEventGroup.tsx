import { Activity, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { cn } from "@/lib/utils";
import type { SessionLogEntry } from "@/types/session-log";

interface SessionEventGroupProps {
  entries: SessionLogEntry[];
}

/**
 * Collapsible group for a run of consecutive `event` session-log entries (e.g.
 * turn_started / agent run failed), tucking low-signal event noise behind a
 * single header while keeping each event expandable inside.
 */
export function SessionEventGroup({ entries }: SessionEventGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="session-event-group"
      >
        <span className="shrink-0 text-muted-foreground">
          <Activity className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t("issue.sessionLog.eventGroup", { count: entries.length })}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          {entries.map((entry, index) => (
            <SessionLogEntryCard entry={entry} key={`event-${entry.title}-${index}`} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
