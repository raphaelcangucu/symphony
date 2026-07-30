import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { TOOL_GROUP_ICON } from "@/components/agent-activity/toolGroupIcons";
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import type { ToolActivityTimings } from "@/components/assistant/toolActivityTiming";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";
import {
  summarizeGroup,
  type ToolCallGroup,
  type ToolGroupSummary,
} from "@/lib/toolCallGroups";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { AssistantToolCall } from "@/services/assistant";

function groupLabel(
  group: ToolCallGroup,
  summary: ToolGroupSummary,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (
    group.kind === "edit" &&
    (summary.additions > 0 || summary.deletions > 0)
  ) {
    return t("assistant.toolGroup.editStats", {
      n: summary.count,
      additions: summary.additions,
      deletions: summary.deletions,
    });
  }
  return t(`assistant.toolGroup.${group.kind}`, { n: summary.count });
}

interface ToolActivityGroupProps extends ActivityDisclosureStateProps {
  group: ToolCallGroup;
  taskSnapshot?: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
  onOpenKbPath?: OpenKbPathHandler;
  callKeys?: readonly string[];
  toolTimings?: ToolActivityTimings;
}

export function ToolActivityGroup({
  group,
  taskSnapshot = null,
  onKillTool,
  onLoadFullOutput,
  onOpenKbPath,
  callKeys,
  toolTimings = {},
  expanded,
  onExpandedChange,
}: ToolActivityGroupProps) {
  const { t } = useTranslation();
  const summary = summarizeGroup(group);
  const running = group.status === "running";
  const failed = group.status === "error";
  const Icon = TOOL_GROUP_ICON[group.kind];
  const rowKeys = resolveRowKeys(group.calls, callKeys);

  return (
    <ActivityDisclosure
      icon={
        running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )
      }
      label={groupLabel(group, summary, t)}
      status={failed ? "failed" : running ? "running" : null}
      statusLabel={
        failed
          ? t("assistant.toolGroup.failed")
          : running
            ? t("assistant.toolGroup.running")
            : undefined
      }
      testId="tool-activity-group"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      details={
        <div className="space-y-0.5">
          {group.calls.map((call, index) => {
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
              <ToolActivityItem
                key={rowKeys[index]}
                toolName={call.name}
                toolCallId={call.id}
                view={assistantToolCallToView(call)}
                taskSnapshot={taskSnapshot}
                fileActivity={fileActivityFromToolCall(call)}
                presentation={presentation}
                onKillTool={onKillTool}
                onLoadFullOutput={onLoadFullOutput}
                onOpenKbPath={onOpenKbPath}
                timing={call.id ? toolTimings[call.id] : undefined}
              />
            );
          })}
        </div>
      }
    />
  );
}

function resolveRowKeys(
  calls: readonly AssistantToolCall[],
  suppliedKeys: readonly string[] | undefined,
): string[] {
  if (suppliedKeys) {
    if (suppliedKeys.length !== calls.length) {
      throw new TypeError("callKeys must match the grouped tool-call count");
    }
    return [...suppliedKeys];
  }

  const idlessOccurrencesByName = new Map<string, number>();
  return calls.map((call) => {
    const stableId = call.id?.trim();
    if (stableId) return JSON.stringify(["tool-call", "id", stableId]);
    const occurrence = idlessOccurrencesByName.get(call.name) ?? 0;
    idlessOccurrencesByName.set(call.name, occurrence + 1);
    return JSON.stringify([
      "tool-call",
      "name",
      call.name,
      "occurrence",
      occurrence,
    ]);
  });
}
