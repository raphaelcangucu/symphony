import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AssistantChatMessageBubble } from "@/components/assistant/AssistantChatMessageBubble";
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
      <CollapsibleCard
        open={open}
        onToggle={() => setOpen((current) => !current)}
        title={entry.title}
        subtitle={t("issue.sessionLog.subtitles.reasoning")}
        tone="muted"
      >
        <p className="text-sm leading-6 text-muted-foreground">{entry.body ?? t("issue.sessionLog.subtitles.thinking")}</p>
      </CollapsibleCard>
    );
  }

  if (entry.kind === "system" || entry.kind === "meta") {
    return (
      <CollapsibleCard
        open={open}
        onToggle={() => setOpen((current) => !current)}
        title={entry.title}
        subtitle={
          entry.kind === "system"
            ? t("issue.sessionLog.subtitles.system")
            : t("issue.sessionLog.subtitles.session")
        }
        tone="muted"
      >
        {entry.body ? <CodeBody language={entry.language} value={entry.body} /> : null}
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen((current) => !current)}
      title={entry.title}
      subtitle={t("issue.sessionLog.subtitles.event")}
      tone="event"
    >
      {entry.body ? <CodeBody language={entry.language} value={entry.body} /> : null}
    </CollapsibleCard>
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

function CollapsibleCard({
  title,
  subtitle,
  tone,
  status,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  tone: "muted" | "tool" | "event";
  status?: string | null;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        tone === "tool" && "border-sky-500/20 bg-sky-500/5",
        tone === "event" && "border-border/70 bg-muted/20",
        tone === "muted" && "border-border/60 bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        {icon ? <span className="mt-0.5 text-muted-foreground">{icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
        {status ? (
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {status}
          </span>
        ) : null}
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && children ? <div className="border-t border-border/60 px-3 py-2.5">{children}</div> : null}
    </article>
  );
}

function CodeBody({ language, value }: { language: SessionLogEntry["language"]; value: string }) {
  if (language === "markdown") {
    return <Markdown className="max-w-none text-sm leading-7">{value}</Markdown>;
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
      {value}
    </pre>
  );
}
