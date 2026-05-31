import { useEffect, useRef } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";

interface UseFocusedIntervalOptions {
  enabled?: boolean;
}

export function useFocusedInterval(
  callback: () => void,
  intervalMs: number,
  options: UseFocusedIntervalOptions = {},
): void {
  const { enabled = true } = options;
  const active = useWindowFocus();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active || !enabled) return undefined;

    callbackRef.current();
    const timer = setInterval(() => callbackRef.current(), intervalMs);

    return () => clearInterval(timer);
  }, [active, enabled, intervalMs]);
}
