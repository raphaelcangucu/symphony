import axios from "axios";

/**
 * True when `error` represents a request that was cancelled via
 * `AbortController` (or axios's own cancel token), as opposed to a real
 * network/server failure. Callers use this to skip setting error state when
 * an in-flight request was intentionally aborted (unmount, key change, etc).
 */
export function isAbortError(error: unknown): boolean {
  if (axios.isCancel(error)) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "CanceledError";
}
