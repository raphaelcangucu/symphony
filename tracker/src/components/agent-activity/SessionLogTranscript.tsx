import { SessionEventGroup } from "@/components/agent-activity/SessionEventGroup";
import { SessionToolActivityGroup } from "@/components/agent-activity/SessionToolActivityGroup";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { groupSessionLogItems, sessionPairToTyped } from "@/components/issues/issue-detail/sessionToolCall";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { SessionLogEntry } from "@/types/session-log";

interface SessionLogTranscriptProps {
  entries: SessionLogEntry[];
  taskSnapshot?: AgentTaskSnapshot | null;
}

/**
 * Renders a session-log stream (execution agent output) using the shared
 * tool-activity primitives, collapsing runs of consecutive same-kind tool calls
 * into groups so the transcript matches the assistant chat.
 */
export function SessionLogTranscript({ entries, taskSnapshot = null }: SessionLogTranscriptProps) {
  const items = groupSessionLogItems(entries);

  return (
    <>
      {items.map((item, index) => {
        if (item.type === "toolGroup") {
          return (
            <SessionToolActivityGroup
              key={`group-${item.kind}-${index}`}
              kind={item.kind}
              status={item.status}
              pairs={item.pairs}
              taskSnapshot={taskSnapshot}
            />
          );
        }

        if (item.type === "toolCall") {
          const typed = sessionPairToTyped({ call: item.call, result: item.result });
          return (
            <ToolActivityItem
              key={`tool-${item.call.callId ?? item.call.title}-${index}`}
              toolName={item.call.title}
              view={typed.view}
              presentation={typed.presentation}
              taskSnapshot={taskSnapshot}
            />
          );
        }

        if (item.type === "eventGroup") {
          return <SessionEventGroup entries={item.entries} key={`event-group-${index}`} />;
        }

        return <SessionLogEntryCard entry={item.entry} key={`${item.entry.kind}-${item.entry.title}-${index}`} />;
      })}
    </>
  );
}
