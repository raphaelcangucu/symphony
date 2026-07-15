import { useRef } from "react";

function shallowStableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Returns a referentially stable value: the previous reference is kept whenever
 * the new value is structurally equal. Used to stop derived objects (recomputed
 * every render from a changing input) from breaking `React.memo` on children
 * that receive them, e.g. the task snapshot passed to every message bubble
 * during streaming.
 */
export function useStableValue<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!shallowStableEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
