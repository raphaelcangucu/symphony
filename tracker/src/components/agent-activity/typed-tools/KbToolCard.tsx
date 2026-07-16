import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import { Button } from "@/components/ui/button";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import type { ToolPresentation, ToolPresentationBadge } from "@/lib/toolCallPresentation";

type KbToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
  onOpenKbPath?: OpenKbPathHandler;
};

function buildBadges(presentation: ToolPresentation): ToolPresentationBadge[] {
  const badges = [...presentation.badges];
  const kbPath = presentation.kbPath?.trim();
  if (kbPath && !badges.some((badge) => badge.label.includes(kbPath))) {
    badges.push({ kind: "neutral", label: kbPath });
  }
  return badges;
}

function buildDetails(
  presentation: ToolPresentation,
  onOpenKbPath: OpenKbPathHandler | undefined,
  openLabel: string,
): ReactNode {
  const { body, raw, kbPath } = presentation;
  const path = kbPath?.trim() ?? null;
  const openAction =
    path && onOpenKbPath ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-[11px]"
        onClick={(event) => {
          event.stopPropagation();
          onOpenKbPath(path);
        }}
      >
        <BookOpen className="size-3.5" aria-hidden />
        {openLabel}
      </Button>
    ) : null;

  if (!body && !raw && !openAction) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
      {openAction}
      {body ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
          {body}
        </pre>
      ) : null}
      {raw ? (
        <div className="min-w-0 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Technical details
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
            {raw}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function KbToolCard({ presentation, onOpenKbPath, ...shellProps }: KbToolCardProps) {
  const { t } = useTranslation();
  const openLabel = t("issue.toolCall.openInKnowledgeBase");
  const details = buildDetails(presentation, onOpenKbPath, openLabel);
  const hasOpenAction = Boolean(presentation.kbPath?.trim() && onOpenKbPath);

  return (
    <TypedToolCardShell
      icon={<BookOpen className="size-3.5" aria-hidden />}
      verb="Knowledge base"
      title={presentation.title}
      summary={presentation.summary}
      status={presentation.status}
      badges={buildBadges(presentation)}
      links={presentation.links}
      details={details}
      defaultCollapsed={!hasOpenAction}
      {...shellProps}
    />
  );
}
