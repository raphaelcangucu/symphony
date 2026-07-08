import { useEffect, useState } from "react";

/**
 * Live clock hook: returns the current epoch milliseconds, re-rendering every
 * `intervalMs`. Pass `enabled: false` to freeze the clock (e.g. paused goals).
 */
export function useNowTick(intervalMs = 1000, options: { enabled?: boolean } = {}): number {
  const { enabled = true } = options;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return nowMs;
}
