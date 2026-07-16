import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  summarizeToolPresentations,
  type TurnSummaryChip,
} from "@/lib/toolCallTurnSummary";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

interface TurnSummaryStripProps {
  presentations: readonly Pick<ToolPresentation, "family">[];
  durationMs?: number;
  className?: string;
}

export function TurnSummaryStrip({
  presentations,
  durationMs = 0,
  className,
}: TurnSummaryStripProps) {
  if (presentations.length === 0) {
    return null;
  }

  const summary = summarizeToolPresentations(presentations, { durationMs });

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-2 rounded-xl border border-dashed border-border/80 bg-muted/30 px-3.5 py-3",
        className,
      )}
      data-testid="turn-summary-strip"
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background"
        aria-hidden
      >
        <Clock className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{summary.headline}</div>
      </div>
      {summary.chips.length > 0 ? (
        <div className="col-span-2 flex flex-wrap gap-1.5">
          {summary.chips.map((chip) => (
            <TurnSummaryChip key={chip.family} chip={chip} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TurnSummaryChip({ chip }: { chip: TurnSummaryChip }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {chip.label}
    </span>
  );
}
