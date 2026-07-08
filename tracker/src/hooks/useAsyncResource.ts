import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface UseAsyncResourceArgs<T> {
  /**
   * Loads the resource. MUST be memoized by the caller (useCallback) — the
   * hook resets its cache whenever the fetcher identity changes, which is how
   * key changes (project/issue/thread) invalidate previously loaded data.
   */
  fetcher: () => Promise<T>;
  /** Whether the fetcher has everything it needs (e.g. identifier present). */
  canFetch: boolean;
  /** Whether the surface consuming the resource is currently active/visible. */
  enabled?: boolean;
  /** Localized message stored in `error` when the fetch fails. */
  errorMessage: () => string;
  /** Value used before the first load and after cache resets. */
  initialData: T;
  /**
   * "once": fetch on first activation only (default).
   * "always": fetch on every activation (e.g. reopening a drawer).
   */
  refetchOnActivate?: "once" | "always";
  /** With "always", skip the activation fetch when data is younger than this. */
  freshWindowMs?: number;
  /** Reset data/error when the surface deactivates (enabled goes false). */
  resetWhenInactive?: boolean;
}

export interface UseAsyncResourceResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Optimistic local updates (e.g. after create/update/delete mutations). */
  setData: Dispatch<SetStateAction<T>>;
}

/**
 * Shared async-fetch state machine: loading/error state, in-flight dedupe,
 * cache reset on key change, and fetch-on-activation. Replaces the
 * boilerplate previously copy-pasted across the issue-scoped data hooks.
 */
export function useAsyncResource<T>({
  fetcher,
  canFetch,
  enabled = true,
  errorMessage,
  initialData,
  refetchOnActivate = "once",
  freshWindowMs,
  resetWhenInactive = false,
}: UseAsyncResourceArgs<T>): UseAsyncResourceResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastFetchedAtRef = useRef(0);
  const initialDataRef = useRef(initialData);
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;
  const canFetchRef = useRef(canFetch);
  canFetchRef.current = canFetch;

  const active = enabled && canFetch;

  const refetch = useCallback(async () => {
    if (!canFetchRef.current) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      hasLoadedRef.current = true;
      lastFetchedAtRef.current = Date.now();
    } catch {
      setError(errorMessageRef.current());
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [fetcher]);

  const reset = useCallback(() => {
    hasLoadedRef.current = false;
    lastFetchedAtRef.current = 0;
    setData(initialDataRef.current);
    setError(null);
    setLoading(false);
  }, []);

  // Key change (new fetcher identity) invalidates the cached data.
  useEffect(() => {
    return () => reset();
  }, [fetcher, reset]);

  useEffect(() => {
    if (!active) {
      if (resetWhenInactive) reset();
      return;
    }
    if (refetchOnActivate === "once" && hasLoadedRef.current) return;
    const fresh =
      freshWindowMs !== undefined &&
      hasLoadedRef.current &&
      Date.now() - lastFetchedAtRef.current < freshWindowMs;
    if (fresh) return;
    void refetch();
  }, [active, refetch, refetchOnActivate, freshWindowMs, resetWhenInactive, reset]);

  return { data, loading, error, refetch, setData };
}
