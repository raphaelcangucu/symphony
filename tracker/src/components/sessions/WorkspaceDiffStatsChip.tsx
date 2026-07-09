import { sessionToolbarChipClassName } from "@/components/sessions/sessionToolbarStyles";
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
      className={cn(sessionToolbarChipClassName, "gap-0.5 font-mono text-[10px] tabular-nums", className)}
      title={`+${stats.additions}/-${stats.deletions} lines`}
    >
      <span className="text-emerald-600">+{stats.additions}</span>
      <span className="text-rose-600">-{stats.deletions}</span>
    </span>
  );
}
