import { isSymphonyLabel } from "@/lib/symphonyLabels";
import type { IssueAssigneeOption } from "@/types/issue";

export function isSymphonyLabelName(name: string): boolean {
  return isSymphonyLabel(name);
}

export function matchesPickerSearch(query: string, ...parts: Array<string | null | undefined>): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return parts.some((part) => part?.toLowerCase().includes(term));
}

export function sortLabelPickerItems<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aSymphony = isSymphonyLabelName(a.label);
    const bSymphony = isSymphonyLabelName(b.label);
    if (aSymphony !== bSymphony) return aSymphony ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export function assigneeMatchesMe(option: IssueAssigneeOption, meIdentities: string[]): boolean {
  if (meIdentities.length === 0) return false;
  const meSet = new Set(meIdentities.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const candidates = [option.id, option.login, option.name]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return candidates.some((candidate) => meSet.has(candidate));
}

export function sortAssigneePickerItems<T extends { label: string; login?: string | null }>(
  items: T[],
  meIdentities: string[],
  meMatcher?: (item: T) => boolean,
): T[] {
  const isMe = meMatcher ?? ((item: T) =>
    meIdentities.some((identity) => {
      const normalized = identity.trim().toLowerCase();
      return item.label.toLowerCase() === normalized || item.login?.toLowerCase() === normalized;
    }));

  return [...items].sort((a, b) => {
    const aMe = isMe(a);
    const bMe = isMe(b);
    if (aMe !== bMe) return aMe ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}
