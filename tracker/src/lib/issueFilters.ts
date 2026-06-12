import type { Issue } from "@/types/issue";

export const ME_TOKEN = "me";
export const UNASSIGNED_TOKEN = "@none";

export const ASSIGNEE_PARAM = "assignee";
export const CREATOR_PARAM = "creator";
export const SEARCH_PARAM = "q";
export const RECENT_PARAM = "updated";

export interface IssueFilters {
  search?: string;
  assignees: string[];
  creators: string[];
  recentDays?: number;
}

export function emptyFilters(): IssueFilters {
  return { assignees: [], creators: [] };
}

export function filtersFromSearchParams(params: URLSearchParams): IssueFilters {
  const filters = emptyFilters();

  const search = params.get(SEARCH_PARAM)?.trim();
  if (search) filters.search = search;

  filters.assignees = parseList(params.get(ASSIGNEE_PARAM));
  filters.creators = parseList(params.get(CREATOR_PARAM));

  const recentDays = parseRecentDays(params.get(RECENT_PARAM));
  if (recentDays) filters.recentDays = recentDays;

  return filters;
}

export function hasActiveFilters(filters: IssueFilters): boolean {
  return (
    Boolean(filters.search) ||
    filters.assignees.length > 0 ||
    filters.creators.length > 0 ||
    filters.recentDays != null
  );
}

export function countActiveFilters(filters: IssueFilters): number {
  return (
    (filters.search ? 1 : 0) +
    filters.assignees.length +
    filters.creators.length +
    (filters.recentDays != null ? 1 : 0)
  );
}

export function applyIssueFilters(issues: Issue[], filters: IssueFilters, meValues: string[] = []): Issue[] {
  const meSet = new Set(meValues.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const search = filters.search?.trim().toLowerCase();
  const cutoff = recentCutoff(filters.recentDays);

  return issues.filter((issue) => {
    if (search && !matchesSearch(issue, search)) return false;
    if (filters.assignees.length > 0 && !matchesPerson(issue.assignee, filters.assignees, meSet, true)) return false;
    if (filters.creators.length > 0 && !matchesPerson(issue.creator, filters.creators, meSet, false)) return false;
    if (cutoff != null && !isRecent(issue.updatedAt, cutoff)) return false;
    return true;
  });
}

/** Returns a copy of `params` with `value` toggled inside the comma-separated `key` list. */
export function toggleListParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  const current = parseList(next.get(key));
  const index = current.indexOf(value);
  if (index >= 0) current.splice(index, 1);
  else current.push(value);
  return writeList(next, key, current);
}

/** Returns a copy of `params` with the comma-separated `key` list set to `values`. */
export function setListParam(params: URLSearchParams, key: string, values: string[]): URLSearchParams {
  return writeList(new URLSearchParams(params), key, values);
}

function writeList(params: URLSearchParams, key: string, values: string[]): URLSearchParams {
  if (values.length > 0) params.set(key, values.join(","));
  else params.delete(key);
  return params;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function parseRecentDays(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^(\d+)/);
  if (!match) return undefined;
  const days = Number.parseInt(match[1], 10);
  return Number.isFinite(days) && days > 0 ? days : undefined;
}

function matchesSearch(issue: Issue, term: string): boolean {
  return (
    issue.title.toLowerCase().includes(term) ||
    issue.identifier.toLowerCase().includes(term) ||
    (issue.description ?? "").toLowerCase().includes(term)
  );
}

function matchesPerson(
  value: string | null,
  tokens: string[],
  meSet: Set<string>,
  allowUnassigned: boolean,
): boolean {
  const normalized = value ? value.toLowerCase() : null;

  return tokens.some((token) => {
    if (token === ME_TOKEN) return normalized != null && meSet.has(normalized);
    if (allowUnassigned && token === UNASSIGNED_TOKEN) return value == null;
    return normalized != null && normalized === token.toLowerCase();
  });
}

function recentCutoff(days: number | undefined): number | null {
  if (!days) return null;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isRecent(updatedAt: string, cutoff: number): boolean {
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) && timestamp >= cutoff;
}
