import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { SessionLogEntry } from "@/types/session-log";

interface SessionLogTranscriptProps {
  entries: SessionLogEntry[];
  taskSnapshot?: AgentTaskSnapshot | null;
}

/** Renders a session-log stream (execution agent output) using the shared tool-activity primitives. */
export function SessionLogTranscript({ entries, taskSnapshot = null }: SessionLogTranscriptProps) {
  const items = pairSessionLogItems(entries);

  return (
    <>
      {items.map((item, index) =>
        item.type === "toolCall" ? (
          <ToolActivityItem
            key={`tool-${item.call.callId ?? item.call.title}-${index}`}
            toolName={item.call.title}
            view={sessionPairToView(item.call, item.result)}
            taskSnapshot={taskSnapshot}
          />
        ) : (
          <SessionLogEntryCard entry={item.entry} key={`${item.entry.kind}-${item.entry.title}-${index}`} />
        ),
      )}
    </>
  );
}
