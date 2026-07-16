import { memo, useState } from "react";

import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { ToolActivityGroup } from "@/components/agent-activity/ToolActivityGroup";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";
import { groupToolCalls, type ToolCallGroup } from "@/lib/toolCallGroups";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { AssistantToolCall } from "@/services/assistant";

interface ToolActivityTimelineProps {
  toolCalls: AssistantToolCall[];
  taskSnapshot?: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
  onOpenKbPath?: OpenKbPathHandler;
}

interface CanonicalToolCall {
  call: AssistantToolCall;
  key: string;
}

interface TimelineGroup {
  group: ToolCallGroup;
  key: string;
  callKeys: string[];
}

function ToolActivityTimelineComponent({
  toolCalls,
  taskSnapshot = null,
  onKillTool,
  onLoadFullOutput,
  onOpenKbPath,
}: ToolActivityTimelineProps) {
  if (toolCalls.length === 0) return null;

  const canonicalToolCalls = canonicalizeToolCalls(toolCalls);
  const groups = buildTimelineGroups(canonicalToolCalls);

  return (
    <div className="min-w-0 space-y-1">
      {groups.map(({ group, key, callKeys }) => (
        <ToolActivityEntry
          key={key}
          group={group}
          callKeys={callKeys}
          taskSnapshot={taskSnapshot}
          onKillTool={onKillTool}
          onLoadFullOutput={onLoadFullOutput}
          onOpenKbPath={onOpenKbPath}
        />
      ))}
    </div>
  );
}

// Memoized so a streaming sibling does not rerender settled tool timelines.
export const ToolActivityTimeline = memo(ToolActivityTimelineComponent);

function ToolActivityEntry({
  group,
  callKeys,
  taskSnapshot,
  onKillTool,
  onLoadFullOutput,
  onOpenKbPath,
}: {
  group: ToolCallGroup;
  callKeys: readonly string[];
  taskSnapshot: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
  onOpenKbPath?: OpenKbPathHandler;
}) {
  const [expanded, setExpanded] = useState(false);

  if (group.calls.length > 1) {
    return (
      <div className="min-w-0">
        <ToolActivityGroup
          group={group}
          taskSnapshot={taskSnapshot}
          onKillTool={onKillTool}
          onLoadFullOutput={onLoadFullOutput}
          onOpenKbPath={onOpenKbPath}
          callKeys={callKeys}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      </div>
    );
  }

  const call = group.calls[0];
  if (!call) return null;

  const presentation = canonicalizeToolCall({
    name: call.name,
    arguments: (call.arguments ?? {}) as Record<string, unknown>,
    output: call.output ?? null,
    status: call.status,
    result: call.result,
    outputTruncated: call.outputTruncated,
    outputByteSize: call.outputByteSize ?? null,
  });

  return (
    <div className="min-w-0">
      <ToolActivityItem
        toolName={call.name}
        toolCallId={call.id}
        view={assistantToolCallToView(call)}
        taskSnapshot={taskSnapshot}
        fileActivity={fileActivityFromToolCall(call)}
        presentation={presentation}
        onKillTool={onKillTool}
        onLoadFullOutput={onLoadFullOutput}
        onOpenKbPath={onOpenKbPath}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
    </div>
  );
}

function canonicalizeToolCalls(
  toolCalls: readonly AssistantToolCall[],
): CanonicalToolCall[] {
  const canonicalCalls: CanonicalToolCall[] = [];
  const indexByStableId = new Map<string, number>();
  const idlessOccurrencesByName = new Map<string, number>();

  for (const toolCall of toolCalls) {
    const stableId = normalizedCallId(toolCall.id);
    if (!stableId) {
      const occurrence = idlessOccurrencesByName.get(toolCall.name) ?? 0;
      idlessOccurrencesByName.set(toolCall.name, occurrence + 1);
      canonicalCalls.push({
        call: toolCall,
        key: legacyCallKey(toolCall.name, occurrence),
      });
      continue;
    }

    const existingIndex = indexByStableId.get(stableId);
    if (existingIndex === undefined) {
      indexByStableId.set(stableId, canonicalCalls.length);
      canonicalCalls.push({ call: toolCall, key: providerCallKey(stableId) });
      continue;
    }
    canonicalCalls[existingIndex] = {
      call: toolCall,
      key: providerCallKey(stableId),
    };
  }

  return canonicalCalls;
}

function buildTimelineGroups(
  canonicalCalls: readonly CanonicalToolCall[],
): TimelineGroup[] {
  const groups = groupToolCalls(canonicalCalls.map(({ call }) => call));
  let callOffset = 0;

  return groups.map((group) => {
    const groupedCalls = canonicalCalls.slice(
      callOffset,
      callOffset + group.calls.length,
    );
    callOffset += group.calls.length;
    return {
      group,
      key: groupKey(groupedCalls),
      callKeys: groupedCalls.map(({ key }) => key),
    };
  });
}

function groupKey(
  canonicalCalls: readonly CanonicalToolCall[],
): string {
  const firstCall = canonicalCalls[0];
  return firstCall?.key ?? JSON.stringify(["tool-activity", "empty"]);
}

function providerCallKey(stableId: string): string {
  return JSON.stringify(["tool-call", "id", stableId]);
}

function legacyCallKey(name: string, occurrence: number): string {
  return JSON.stringify(["tool-call", "name", name, "occurrence", occurrence]);
}

function normalizedCallId(id: string | null): string | null {
  if (typeof id !== "string") return null;
  const normalized = id.trim();
  return normalized === "" ? null : normalized;
}
