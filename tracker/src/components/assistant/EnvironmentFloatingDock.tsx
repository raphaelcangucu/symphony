import { GitBranch, GitCommitHorizontal, GitCompare, HardDrive, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EnvironmentFloatingDockProps {
  open: boolean;
  onClose: () => void;
  additions: number;
  deletions: number;
  branch?: string | null;
  sourceLabel?: string | null;
  onCompare?: () => void;
  onCommitPush?: () => void;
  className?: string;
}

export function EnvironmentFloatingDock({
  open,
  onClose,
  additions,
  deletions,
  branch = null,
  sourceLabel = null,
  onCompare,
  onCommitPush,
  className,
}: EnvironmentFloatingDockProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <aside
      data-testid="environment-floating-dock"
      className={cn(
        "absolute bottom-24 right-3 top-12 z-20 w-[220px] flex flex-col gap-3 overflow-y-auto rounded-xl border border-border/70 bg-background/95 p-3 shadow-md backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("assistant.environment.title")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("assistant.environment.close")}
          onClick={onClose}
          className="h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{t("assistant.environment.changes")}</span>
        <span className="flex items-center gap-1.5 font-mono">
          <span className="font-semibold text-emerald-500">+{additions}</span>
          <span className="font-semibold text-rose-500">−{deletions}</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("assistant.environment.local")}</span>
      </div>

      {branch ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono" title={branch}>
            {branch}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          aria-label={t("assistant.environment.commitPush")}
          onClick={onCommitPush}
          disabled={!onCommitPush}
        >
          <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t("assistant.environment.commitPush")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          aria-label={t("assistant.environment.compare")}
          onClick={onCompare}
          disabled={!onCompare}
        >
          <GitCompare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t("assistant.environment.compare")}</span>
        </Button>
      </div>

      {sourceLabel ? (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("assistant.environment.sources")}
          </p>
          <p className="truncate text-xs" title={sourceLabel}>
            {sourceLabel}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
