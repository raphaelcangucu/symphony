import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KbSyncState, KbSyncStatus } from "@/types/knowledgeBase";

interface Props {
  state: KbSyncState | null;
  syncing?: boolean;
  onSync: () => void;
}

const STATUS_STYLES: Record<KbSyncStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  syncing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  open_pr: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  merged: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  conflict: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  checks_failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const FAILURE_STATUSES: KbSyncStatus[] = ["conflict", "checks_failed", "error"];

export function KbSyncBadge({ state, syncing = false, onSync }: Props) {
  const { t } = useTranslation();
  const status: KbSyncStatus = state?.status ?? "idle";
  const showFailure = FAILURE_STATUSES.includes(status) && Boolean(state?.lastError);

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          STATUS_STYLES[status],
        )}
      >
        {t(`kb.sync.status.${status}`)}
      </span>

      {state?.prUrl && (
        <a
          href={state.prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {state.prNumber ? `#${state.prNumber}` : t("kb.sync.viewPr")}
        </a>
      )}

      {showFailure && (
        <span className="max-w-[16rem] truncate text-xs text-red-600" title={state?.lastError ?? undefined}>
          {state?.lastError}
        </span>
      )}

      <Button size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
        <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
        {t("kb.sync.now")}
      </Button>
    </div>
  );
}
