import { Brain, CircleDot, Info, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";
import { AssistantChatMessageBubble } from "@/components/assistant/AssistantChatMessageBubble";
import { ASSISTANT_CHAT_MESSAGE_TEXT_CLASS } from "@/components/assistant/chatTypography";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { AssistantChatMessage } from "@/services/assistant";
import type { SessionLogEntry } from "@/types/session-log";

interface SessionLogEntryCardProps {
  entry: SessionLogEntry;
}

export function SessionLogEntryCard({ entry }: SessionLogEntryCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!entry.collapsed);

  if (entry.kind === "assistant" || entry.kind === "user" || entry.kind === "message") {
    return <AssistantChatMessageBubble message={chatMessageFromSessionEntry(entry)} />;
  }

  if (entry.kind === "reasoning") {
    return (
      <ActivityDisclosure
        icon={<Brain className="size-3.5" />}
        label={entry.title}
        metadata={t("issue.sessionLog.subtitles.reasoning")}
        expanded={open}
        onExpandedChange={setOpen}
        details={
          <p className={cn(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS, "text-muted-foreground")}>
            {entry.body ?? t("issue.sessionLog.subtitles.thinking")}
          </p>
        }
      />
    );
  }

  if (entry.kind === "system" || entry.kind === "meta") {
    const Icon: LucideIcon = entry.kind === "system" ? Info : CircleDot;
    return (
      <ActivityDisclosure
        icon={<Icon className="size-3.5" />}
        label={entry.title}
        metadata={
          entry.kind === "system"
            ? t("issue.sessionLog.subtitles.system")
            : t("issue.sessionLog.subtitles.session")
        }
        expanded={open}
        onExpandedChange={setOpen}
        details={entry.body ? <CodeBody language={entry.language} value={entry.body} /> : null}
      />
    );
  }

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

function chatMessageFromSessionEntry(entry: SessionLogEntry): AssistantChatMessage {
  return {
    id: `session-${entry.kind}-${entry.callId ?? entry.title}`,
    role: entry.kind === "user" ? "user" : "assistant",
    content: entry.body ?? "",
    toolCalls: [],
    metadata: {},
  };
}

function CodeBody({ language, value }: { language: SessionLogEntry["language"]; value: string }) {
  if (language === "markdown") {
    return <Markdown className={cn(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS, "max-w-none")}>{value}</Markdown>;
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[length:var(--chat-mono,11.5px)] leading-5 text-foreground/90">
      {value}
    </pre>
  );
}
