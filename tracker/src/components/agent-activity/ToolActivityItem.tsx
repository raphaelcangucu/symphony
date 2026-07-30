import { useTranslation } from "react-i18next";

import type { ActivityDisclosureStateProps } from "@/components/agent-activity/ActivityDisclosure";
import { AgentTaskInlineCard } from "@/components/agent-activity/AgentTaskInlineCard";
import { useSubagentDrawer } from "@/components/agent-activity/subagentDrawerContext";
import { SubagentToolCard } from "@/components/agent-activity/typed-tools/SubagentToolCard";
import { renderTypedToolCard } from "@/components/agent-activity/typed-tools/renderTypedToolCard";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import type { ToolActivityTiming } from "@/components/assistant/toolActivityTiming";
import {
  ToolCallBlock,
  type ToolCallView,
} from "@/components/shared/ToolCallBlock";
import { Button } from "@/components/ui/button";
import { isAgentTaskTool } from "@/lib/agentTasks";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import { getSubagentRef, type SubagentRef } from "@/lib/subagentRef";
import type { ToolPresentation } from "@/lib/toolCallPresentation";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

export interface ToolActivityItemProps extends ActivityDisclosureStateProps {
  toolName: string;
  toolCallId?: string | null;
  view: ToolCallView;
  taskSnapshot?: AgentTaskSnapshot | null;
  fileActivity?: FileActivityView | null;
  presentation?: ToolPresentation | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
  onOpenKbPath?: OpenKbPathHandler;
  timing?: ToolActivityTiming;
}

/** Renders one tool invocation: task marker, file-activity card, typed card, or the standard tool block. */
export function ToolActivityItem({
  toolName,
  toolCallId = null,
  view,
  taskSnapshot,
  fileActivity,
  presentation = null,
  onKillTool,
  onLoadFullOutput,
  onOpenKbPath,
  timing,
  expanded,
  onExpandedChange,
}: ToolActivityItemProps) {
  const drawer = useSubagentDrawer();
  const { t } = useTranslation();
  const killId =
    view.status === "running" && onKillTool && toolCallId
      ? toolCallId.trim()
      : "";
  const killAction = killId ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => onKillTool?.(killId)}
    >
      {t("assistant.working.kill")}
    </Button>
  ) : null;

  if (taskSnapshot && isAgentTaskTool(toolName)) {
    return (
      <AgentTaskInlineCard
        snapshot={taskSnapshot}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    );
  }

  if (view.kind === "create_plan") {
    return (
      <ToolCallBlockWithKill
        view={view}
        toolCallId={toolCallId}
        onKillTool={onKillTool}
        onLoadFullOutput={onLoadFullOutput}
        onOpenKbPath={onOpenKbPath}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    );
  }

  const isHealthWait = presentation?.meta?.healthWait === true;
  if (fileActivity && !isHealthWait) {
    return (
      <FileActivityCard
        view={fileActivity}
        startedAt={timing?.startedAt}
        durationMs={timing?.durationMs}
        onKill={killId ? () => onKillTool?.(killId) : undefined}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    );
  }

  if (presentation) {
    const typedCard = renderTypedToolCard(presentation, {
      expanded,
      onExpandedChange,
      onOpenKbPath,
      trailingAction: killAction,
    });
    if (typedCard) {
      return typedCard;
    }
  }

  // Cursor Task / Claude TaskCreate (and any spawn that lacked a typed card).
  if (drawer) {
    const ref = getSubagentRef({
      toolName,
      args: parseToolCallArgs(view),
      output: parseToolCallOutput(view),
      toolCallId,
    });
    if (ref) {
      return (
        <SubagentToolCard
          presentation={presentationFromSubagentView(toolName, view, ref)}
          subagentRef={ref}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
        />
      );
    }
  }

  return (
    <ToolCallBlockWithKill
      view={view}
      toolCallId={toolCallId}
      onKillTool={onKillTool}
      onLoadFullOutput={onLoadFullOutput}
      onOpenKbPath={onOpenKbPath}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}

function parseToolCallArgs(view: ToolCallView): unknown {
  const raw = view.input?.value;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseToolCallOutput(view: ToolCallView): unknown {
  const raw = view.output?.value;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function presentationFromSubagentView(
  toolName: string,
  view: ToolCallView,
  ref: SubagentRef,
): ToolPresentation {
  const status =
    view.status === "running" ||
    view.status === "completed" ||
    view.status === "failed"
      ? view.status
      : null;

  return {
    family: "spawn_agent",
    toolName,
    title: ref.nickname ?? ref.taskPreview ?? toolName,
    summary: ref.taskPreview ?? null,
    status,
    badges: [],
    links: [],
    body: null,
    raw: null,
    meta: {},
    subagentRef: ref,
  };
}

function ToolCallBlockWithKill({
  view,
  toolCallId,
  onKillTool,
  onLoadFullOutput,
  onOpenKbPath,
  expanded,
  onExpandedChange,
}: {
  view: ToolCallView;
  toolCallId: string | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
  onOpenKbPath?: OpenKbPathHandler;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { t } = useTranslation();
  const killId = typeof toolCallId === "string" ? toolCallId.trim() : "";
  const showKill =
    view.status === "running" && Boolean(onKillTool) && killId.length > 0;

  if (!showKill) {
    return (
      <ToolCallBlock
        view={view}
        toolCallId={toolCallId}
        onLoadFullOutput={onLoadFullOutput}
        onOpenKbPath={onOpenKbPath}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onKillTool?.(killId)}
        >
          {t("assistant.working.kill")}
        </Button>
      </div>
      <ToolCallBlock
        view={view}
        toolCallId={toolCallId}
        onLoadFullOutput={onLoadFullOutput}
        onOpenKbPath={onOpenKbPath}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    </div>
  );
}
