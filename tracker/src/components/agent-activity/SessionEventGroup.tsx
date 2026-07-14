import { Activity } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";
import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import type { SessionLogEntry } from "@/types/session-log";

interface SessionEventGroupProps {
  entries: SessionLogEntry[];
}

/**
 * Collapsible group for consecutive `event` session-log entries — same
 * ActivityDisclosure chrome as interactive tool activity.
 */
export function SessionEventGroup({ entries }: SessionEventGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <ActivityDisclosure
      icon={<Activity className="size-3.5" />}
      label={t("issue.sessionLog.eventGroup", { count: entries.length })}
      testId="session-event-group"
      expanded={open}
      onExpandedChange={setOpen}
      details={
        <div className="space-y-0.5">
          {entries.map((entry, index) => (
            <SessionLogEntryCard entry={entry} key={`event-${entry.title}-${index}`} />
          ))}
        </div>
      }
    />
  );
}
