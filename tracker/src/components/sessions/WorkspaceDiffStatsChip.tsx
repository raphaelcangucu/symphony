import type { DiffStats } from "@/lib/diffStats";
import { cn } from "@/lib/utils";

interface WorkspaceDiffStatsChipProps {
  stats: DiffStats | null;
  className?: string;
}

export function WorkspaceDiffStatsChip({ stats, className }: WorkspaceDiffStatsChipProps) {
  if (!stats) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        className,
      )}
      title={`+${stats.additions}/-${stats.deletions} lines`}
    >
      <span className="text-emerald-600">+{stats.additions}</span>
      <span className="text-rose-600">-{stats.deletions}</span>
    </span>
  );
}
