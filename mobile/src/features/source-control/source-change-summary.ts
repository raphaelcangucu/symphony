import type { GitDiffStatsResult } from "@/api/contracts";

export type SourceChangeSummary = {
  additions: number;
  deletions: number;
  filesChanged: number;
};

export function sourceChangeSummary(
  result: GitDiffStatsResult | undefined,
): SourceChangeSummary | null {
  const summary = (result?.stats ?? []).reduce<SourceChangeSummary>(
    (current, stat) => ({
      additions: current.additions + stat.additions,
      deletions: current.deletions + stat.deletions,
      filesChanged: current.filesChanged + stat.filesChanged,
    }),
    { additions: 0, deletions: 0, filesChanged: 0 },
  );
  return summary.filesChanged > 0 ? summary : null;
}
