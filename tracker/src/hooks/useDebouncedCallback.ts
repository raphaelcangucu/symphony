import { useEffect, useMemo, useRef } from "react";

export interface DebouncedCallback<Args extends unknown[]> {
  (...args: Args): void;
  /** Cancel any pending invocation (e.g. when committing immediately). */
  cancel: () => void;
}

/**
 * Returns a debounced wrapper around `callback`. The latest callback is always
 * invoked (no stale closures) and any pending invocation is cancelled on
 * unmount. Complements `useDebouncedValue` for imperative call sites.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): DebouncedCallback<Args> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<number | null>(null);

  const debounced = useMemo(() => {
    const run = (...args: Args) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => callbackRef.current(...args), delayMs);
    };
    run.cancel = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    return run as DebouncedCallback<Args>;
  }, [delayMs]);

  useEffect(() => {
    return () => debounced.cancel();
  }, [debounced]);

  return debounced;
}
