import type { Issue } from "@/types/issue";

export interface IssueFilters {
  search?: string;
  assignee?: string;
  creator?: string;
}

const SUPPORTED_KEYS = ["q", "assignee", "creator"] as const;

export function filtersFromSearchParams(params: URLSearchParams): IssueFilters {
  const filters: IssueFilters = {};
  for (const key of SUPPORTED_KEYS) {
    const raw = params.get(key);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (key === "q") filters.search = trimmed;
    if (key === "assignee") filters.assignee = trimmed;
    if (key === "creator") filters.creator = trimmed;
  }
  return filters;
}

export function applyIssueFilters(issues: Issue[], filters: IssueFilters, viewerLogin: string | null): Issue[] {
  const resolved = resolveMeFilters(filters, viewerLogin);

  return issues.filter((issue) => {
    if (resolved.search) {
      const term = resolved.search.toLowerCase();
      const haystack = [issue.title, issue.description ?? "", issue.identifier].join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    if (resolved.assignee && issue.assignee !== resolved.assignee) return false;
    if (resolved.creator && issue.creator !== resolved.creator) return false;
    return true;
  });
}

function resolveMeFilters(filters: IssueFilters, viewerLogin: string | null): IssueFilters {
  const resolved: IssueFilters = { ...filters };
  if (resolved.assignee === "me") {
    resolved.assignee = viewerLogin ?? undefined;
  }
  if (resolved.creator === "me") {
    resolved.creator = viewerLogin ?? undefined;
  }
  return resolved;
}
