import { Boxes, CircleDot, Eye, GitBranch, GitBranchPlus, GitPullRequest, Wand2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { LauncherDataItem } from "@/components/launcher/useLauncherData";
import { Button } from "@/components/ui/button";
import { looseExecutionStatusDotClass } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";
import type { LauncherTabId } from "@/types/launcher";

const TAB_ICON: Record<LauncherTabId, typeof CircleDot> = {
  actions: Zap,
  issues: CircleDot,
  prs: GitPullRequest,
  branches: GitBranch,
};

export interface LauncherItemRowActions {
  showPreview?: boolean;
  showInvestigate?: boolean;
  showStack?: boolean;
  onPreview?: () => void;
  onInvestigate?: (background: boolean) => void;
  onStack?: () => void;
}

function stopRowSelect(event: React.MouseEvent | React.PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function LauncherItemRow({
  item,
  tab,
  actions,
}: {
  item: LauncherDataItem;
  tab: LauncherTabId;
  actions?: LauncherItemRowActions;
}) {
  const { t } = useTranslation();
  const Icon = TAB_ICON[tab] ?? Boxes;

  const showPreview = actions?.showPreview ?? false;
  const showInvestigate = actions?.showInvestigate ?? false;
  const showStack = actions?.showStack ?? false;
  const hasActions = showPreview || showInvestigate || showStack;

  return (
    <div className="flex w-full items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{item.title}</div>
        {item.subtitle ? <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div> : null}
      </div>
      {item.status ? (
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", looseExecutionStatusDotClass(item.status))}
          aria-label={t(`launcher.status.${item.status}`)}
        />
      ) : null}
      {hasActions ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            "opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100",
          )}
        >
          {showPreview ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("launcher.actions.preview")}
              title={t("launcher.actions.previewHint")}
              onPointerDown={stopRowSelect}
              onClick={(event) => {
                stopRowSelect(event);
                actions?.onPreview?.();
              }}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          {showInvestigate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("launcher.actions.investigate")}
              title={t("launcher.actions.investigateHint")}
              onPointerDown={stopRowSelect}
              onClick={(event) => {
                stopRowSelect(event);
                actions?.onInvestigate?.(event.metaKey || event.ctrlKey);
              }}
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          {showStack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("launcher.actions.stack")}
              title={t("launcher.actions.stackHint")}
              onPointerDown={stopRowSelect}
              onClick={(event) => {
                stopRowSelect(event);
                actions?.onStack?.();
              }}
            >
              <GitBranchPlus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
