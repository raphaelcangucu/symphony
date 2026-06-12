import type { Issue } from "@/types/issue";

export interface PersonFacet {
  /** The raw assignee/creator string used for matching (GitHub login or Jira display name). */
  value: string;
  /** How many issues currently reference this person on the field. */
  count: number;
}

type PersonField = "assignee" | "creator";

/** Distinct people on a field, with issue counts, sorted by count desc then name. */
export function peopleFromIssues(issues: Issue[], field: PersonField): PersonFacet[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const value = issue[field];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}

/** Number of issues with no assignee. */
export function unassignedCount(issues: Issue[]): number {
  let total = 0;
  for (const issue of issues) if (!issue.assignee) total += 1;
  return total;
}
