import { useEffect, useRef, useState } from "react";

import { listProjectBranches, type ProjectBranch } from "@/services/projectBranches";

export interface UseProjectBranchesResult {
  branches: ProjectBranch[];
  loading: boolean;
  /** True when the GitHub list failed or returned empty — UI should rely on fallbacks. */
  usedFallback: boolean;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Loads remote branches for a project while `active` is true.
 * When `query` has 2+ characters, searches via `?q=` (matching-refs) after debounce.
 * Failures resolve to an empty list so callers can apply local fallbacks.
 */
export function useProjectBranches(
  projectSlug: string,
  active: boolean,
  query = "",
): UseProjectBranchesResult {
  const [branches, setBranches] = useState<ProjectBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDebouncedQuery("");
      return;
    }

    const handle = window.setTimeout(() => setDebouncedQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const slug = projectSlug.trim();
    if (!active || !slug) {
      setBranches([]);
      setLoading(false);
      setUsedFallback(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setUsedFallback(false);

    void listProjectBranches(slug, debouncedQuery ? { query: debouncedQuery } : {})
      .then((next) => {
        if (requestId !== requestIdRef.current) return;
        setBranches(next);
        setUsedFallback(next.length === 0);
        setLoading(false);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setBranches([]);
        setUsedFallback(true);
        setLoading(false);
      });
  }, [active, debouncedQuery, projectSlug]);

  return { branches, loading, usedFallback };
}
