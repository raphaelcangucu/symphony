import type { ToolFamily, ToolPresentation } from "@/lib/toolCallPresentation";

export interface TurnSummaryChip {
  family: string;
  count: number;
  label: string;
}

export interface TurnSummary {
  headline: string;
  chips: TurnSummaryChip[];
}

const CHIP_FAMILY_LABELS: Partial<Record<ToolFamily, string>> = {
  command: "command",
  search: "search",
  preview: "preview",
  board_query: "board",
  board_action: "board",
  acceptance: "acceptance",
  evidence: "evidence",
  kb: "kb",
  devenv: "devenv",
  tunnel: "tunnel",
  file_read: "read",
  file_edit: "edit",
  generic_mcp: "mcp",
};

export function formatWorkedDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return "<1s";
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export function summarizeToolPresentations(
  presentations: readonly Pick<ToolPresentation, "family">[],
  opts: { durationMs: number },
): TurnSummary {
  const counts = new Map<string, number>();

  for (const presentation of presentations) {
    const key = presentation.family;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const chips = [...counts.entries()]
    .map(([family, count]) => ({
      family,
      count,
      label: formatChipLabel(family, count),
    }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family));

  const headline =
    opts.durationMs > 0
      ? `Worked for ${formatWorkedDuration(opts.durationMs)}`
      : "Worked this turn";

  return { headline, chips };
}

function formatChipLabel(family: string, count: number): string {
  const familyLabel =
    CHIP_FAMILY_LABELS[family as ToolFamily] ??
    family.replace(/_/g, " ");
  return `${count} ${familyLabel}`;
}
