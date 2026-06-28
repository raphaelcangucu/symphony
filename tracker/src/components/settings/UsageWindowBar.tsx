import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { UsageWindow } from "@/types/agent-usage";

interface UsageWindowBarProps {
  label: string;
  usageWindow: UsageWindow | null;
}

function formatResetTime(resetsAt: number | null): string | null {
  if (resetsAt == null) return null;

  const date = new Date(resetsAt * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function barTone(percent: number): string {
  if (percent >= 90) return "bg-destructive";
  if (percent >= 70) return "bg-amber-500";
  return "bg-primary";
}

export function UsageWindowBar({ label, usageWindow }: UsageWindowBarProps) {
  const { t } = useTranslation();

  if (!usageWindow) return null;

  const percent = Math.min(100, Math.max(0, usageWindow.usedPercent));
  const rounded = Math.round(percent);
  const resets = formatResetTime(usageWindow.resetsAt);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{rounded}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", barTone(percent))}
          style={{ width: `${percent}%` }}
        />
      </div>
      {resets ? (
        <p className="text-[11px] text-muted-foreground">{t("settings.usage.resets", { time: resets })}</p>
      ) : null}
    </div>
  );
}
