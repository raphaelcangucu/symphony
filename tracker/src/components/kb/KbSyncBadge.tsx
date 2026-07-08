import { useTranslation } from "react-i18next";

import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/statusPresentation";
import type { KbSyncState, KbSyncStatus } from "@/types/knowledgeBase";

interface Props {
  state: KbSyncState | null;
}

const STATUS_TONES: Record<KbSyncStatus, StatusTone> = {
  idle: "muted",
  syncing: "info",
  synced: "success",
  open_pr: "warning",
  merged: "success",
  conflict: "destructive",
  checks_failed: "destructive",
  error: "destructive",
};

const FAILURE_STATUSES: KbSyncStatus[] = ["conflict", "checks_failed", "error"];

export function KbSyncBadge({ state }: Props) {
  const { t } = useTranslation();
  const status: KbSyncStatus = state?.status ?? "idle";
  const showFailure = FAILURE_STATUSES.includes(status) && Boolean(state?.lastError);

  return (
    <div className="flex items-center gap-2">
      <StatusPill tone={STATUS_TONES[status]} size="md">
        {t(`kb.sync.status.${status}`)}
      </StatusPill>

      {state?.prUrl ? (
        <a
          href={state.prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {state.prNumber ? `#${state.prNumber}` : t("kb.sync.viewPr")}
        </a>
      ) : null}

      {showFailure ? (
        <span className="max-w-[16rem] truncate text-xs text-destructive" title={state?.lastError ?? undefined}>
          {state?.lastError}
        </span>
      ) : null}
    </div>
  );
}
