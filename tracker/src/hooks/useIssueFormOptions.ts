import { useEffect, useState } from "react";

import { getIssueFormOptions } from "@/services/issues";
import type { IssueFormOptions } from "@/types/issue";

export const EMPTY_ISSUE_FORM_OPTIONS: IssueFormOptions = {
  labels: [],
  assignees: [],
  statuses: [],
  agents: [],
  effectiveAgent: "codex",
};

// In-flight request dedupe so the summary tab, comments tab and create dialog
// mounted for the same project share a single fetch instead of three.
const inFlight = new Map<string, Promise<IssueFormOptions>>();

function fetchIssueFormOptionsShared(projectSlug: string): Promise<IssueFormOptions> {
  const pending = inFlight.get(projectSlug);
  if (pending) return pending;

  const promise = getIssueFormOptions(projectSlug).finally(() => {
    inFlight.delete(projectSlug);
  });
  inFlight.set(projectSlug, promise);
  return promise;
}

interface UseIssueFormOptionsArgs {
  enabled?: boolean;
}

export interface UseIssueFormOptionsResult {
  options: IssueFormOptions;
  loading: boolean;
}

/**
 * Loads the label/assignee/status/agent options used by issue forms, with a
 * shared per-project cache. Falls back to empty options on failure.
 */
export function useIssueFormOptions(
  projectSlug: string,
  { enabled = true }: UseIssueFormOptionsArgs = {},
): UseIssueFormOptionsResult {
  const [options, setOptions] = useState<IssueFormOptions>(EMPTY_ISSUE_FORM_OPTIONS);
  const [loading, setLoading] = useState(false);

  const active = enabled && Boolean(projectSlug.trim());

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    setLoading(true);
    fetchIssueFormOptionsShared(projectSlug)
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions(EMPTY_ISSUE_FORM_OPTIONS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, projectSlug]);

  return { options, loading };
}
