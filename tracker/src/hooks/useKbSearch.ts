import { useEffect, useRef, useState } from "react";
import type { KbSearchResult } from "@/types/knowledgeBase";
import { searchProject } from "@/services/knowledgeBase";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export interface UseKbSearchResult {
  results: KbSearchResult[];
  loading: boolean;
}

export function useKbSearch(projectSlug: string, query: string, repo?: string): UseKbSearchResult {
  const [results, setResults] = useState<KbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await searchProject(projectSlug, trimmed, repo ? { repo } : {});
        if (requestId === requestIdRef.current) setResults(rows);
      } catch {
        if (requestId === requestIdRef.current) setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [projectSlug, query, repo]);

  return { results, loading };
}
