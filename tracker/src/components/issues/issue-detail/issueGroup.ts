import type { Issue } from "@/types/issue";

export interface IssueGroupMember {
  identifier: string;
  /** Resolved issue when present in the board list; null when outside the current view. */
  issue: Issue | null;
  isLead: boolean;
}

export interface ResolvedIssueGroup {
  leadIdentifier: string;
  /** Lead first, then members in their stored order. Always includes the current issue. */
  members: IssueGroupMember[];
}

/**
 * Builds the full group an issue belongs to from the board list.
 *
 * Works whether `current` is the lead (its `groupMemberIdentifiers` lists the
 * members) or a member (its `groupLeadIdentifier` points at the lead, whose own
 * record carries the sibling list). Falls back gracefully when some siblings
 * aren't in the loaded list — they still show as links so navigation works.
 */
export function resolveIssueGroup(current: Issue, all: readonly Issue[]): ResolvedIssueGroup | null {
  const byId = new Map(all.map((issue) => [issue.identifier, issue]));
  const isLead = current.groupMemberIdentifiers.length > 0;
  const leadIdentifier = isLead ? current.identifier : current.groupLeadIdentifier;
  if (!leadIdentifier) return null;

  const leadIssue = leadIdentifier === current.identifier ? current : (byId.get(leadIdentifier) ?? null);
  const memberIdentifiers =
    leadIssue?.groupMemberIdentifiers ?? (isLead ? current.groupMemberIdentifiers : [current.identifier]);

  const seen = new Set<string>();
  const members: IssueGroupMember[] = [];
  for (const identifier of [leadIdentifier, ...memberIdentifiers]) {
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    members.push({
      identifier,
      issue: identifier === current.identifier ? current : (byId.get(identifier) ?? null),
      isLead: identifier === leadIdentifier,
    });
  }

  if (members.length < 2) return null;
  return { leadIdentifier, members };
}
