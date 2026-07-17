import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSubagentDrawer } from "@/components/agent-activity/subagentDrawerContext";
import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import { Button } from "@/components/ui/button";
import type { SubagentRef } from "@/lib/subagentRef";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

type SubagentToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
  subagentRef: SubagentRef;
};

export function SubagentToolCard({
  presentation,
  subagentRef,
  ...shellProps
}: SubagentToolCardProps) {
  const { t } = useTranslation();
  const drawer = useSubagentDrawer();

  const title =
    subagentRef.nickname?.trim() ||
    subagentRef.taskPreview?.trim() ||
    presentation.title ||
    presentation.toolName;

  const badges = [...presentation.badges];
  const roleLabel = subagentRef.subagentType?.trim();
  if (roleLabel && !badges.some((badge) => badge.label === roleLabel)) {
    badges.push({ kind: "neutral", label: roleLabel });
  }

  const summary = subagentRef.taskPreview?.trim() || presentation.summary;
  const { body, raw } = presentation;

  const details =
    body || raw ? (
      <div className="min-w-0 space-y-2">
        {body ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
            {body}
          </pre>
        ) : null}
        {raw ? (
          <div className="min-w-0 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("issue.toolCall.typed.technicalDetails")}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
              {raw}
            </pre>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="space-y-1">
      <TypedToolCardShell
        icon={<Bot className="size-3.5" aria-hidden />}
        verb={t("issue.toolCall.subagent.verb")}
        title={title}
        summary={summary}
        status={presentation.status}
        badges={badges}
        links={presentation.links}
        details={details}
        defaultCollapsed
        {...shellProps}
      />
      {drawer ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            data-testid="subagent-view-activity"
            onClick={() => drawer.openSubagent(subagentRef)}
          >
            {t("issue.toolCall.subagent.viewActivity")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
