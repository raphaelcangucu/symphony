import { Activity, Brain, CircleDot, Info, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";
import { ASSISTANT_CHAT_MESSAGE_TEXT_CLASS } from "@/components/assistant/chatTypography";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type {
  SessionLogFeedDisclosureItem,
  SessionLogFeedEventGroupEntry,
  SessionLogFeedEventGroupItem,
} from "@/lib/sessionLogFeed";
import type { SessionLogEntryLanguage } from "@/types/session-log";

/**
 * Disclosure + event-group chrome for session-log feed items in the unified
 * execution chat body.
 */

export function SessionLogFeedDisclosure({ item }: { item: SessionLogFeedDisclosureItem }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!item.collapsed);

  if (item.kind === "reasoning") {
    return (
      <ActivityDisclosure
        icon={<Brain className="size-3.5" />}
        label={item.title}
        metadata={t("issue.sessionLog.subtitles.reasoning")}
        expanded={open}
        onExpandedChange={setOpen}
        details={
          <p className={cn(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS, "text-muted-foreground")}>
            {item.body ?? t("issue.sessionLog.subtitles.thinking")}
          </p>
        }
      />
    );
  }

  if (item.kind === "system" || item.kind === "meta") {
    const Icon: LucideIcon = item.kind === "system" ? Info : CircleDot;
    return (
      <ActivityDisclosure
        icon={<Icon className="size-3.5" />}
        label={item.title}
        metadata={
          item.kind === "system"
            ? t("issue.sessionLog.subtitles.system")
            : t("issue.sessionLog.subtitles.session")
        }
        expanded={open}
        onExpandedChange={setOpen}
        details={item.body ? <CodeBody language={item.language} value={item.body} /> : null}
      />
    );
  }

  return (
    <ActivityDisclosure
      icon={<CircleDot className="size-3.5" />}
      label={item.title}
      metadata={t("issue.sessionLog.subtitles.event")}
      expanded={open}
      onExpandedChange={setOpen}
      details={item.body ? <CodeBody language={item.language} value={item.body} /> : null}
    />
  );
}

export function SessionLogFeedEventGroup({ item }: { item: SessionLogFeedEventGroupItem }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <ActivityDisclosure
      icon={<Activity className="size-3.5" />}
      label={t("issue.sessionLog.eventGroup", { count: item.entries.length })}
      testId="session-event-group"
      expanded={open}
      onExpandedChange={setOpen}
      details={
        <div className="space-y-0.5">
          {item.entries.map((entry) => (
            <EventGroupEntryDisclosure key={entry.id} entry={entry} />
          ))}
        </div>
      }
    />
  );
}

function EventGroupEntryDisclosure({ entry }: { entry: SessionLogFeedEventGroupEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!entry.collapsed);

  return (
    <ActivityDisclosure
      icon={<CircleDot className="size-3.5" />}
      label={entry.title}
      metadata={t("issue.sessionLog.subtitles.event")}
      expanded={open}
      onExpandedChange={setOpen}
      details={entry.body ? <CodeBody language={entry.language} value={entry.body} /> : null}
    />
  );
}

function CodeBody({ language, value }: { language: SessionLogEntryLanguage; value: string }) {
  if (language === "markdown") {
    return <Markdown className={cn(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS, "max-w-none")}>{value}</Markdown>;
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[length:var(--chat-mono,11.5px)] leading-5 text-foreground/90">
      {value}
    </pre>
  );
}
