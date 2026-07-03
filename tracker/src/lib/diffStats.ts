export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStatsFromPatch(patch: string): DiffStats {
  const stats: DiffStats = { additions: 0, deletions: 0 };

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) stats.additions += 1;
    if (line.startsWith("-")) stats.deletions += 1;
  }

  return stats;
}

export function combineDiffStats(stats: Iterable<DiffStats>): DiffStats {
  const total: DiffStats = { additions: 0, deletions: 0 };
  for (const entry of stats) {
    total.additions += entry.additions;
    total.deletions += entry.deletions;
  }
  return total;
}
