export const TRACKER_TOKEN_KEY = "symphony.tracker.token";
export const API_PREFIX = "/api/tracker/v1";
export const SOCKET_PATH = "/socket";

export function getTrackerToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TRACKER_TOKEN_KEY);
}

export function setTrackerToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TRACKER_TOKEN_KEY, token.trim());
}

export function clearTrackerToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TRACKER_TOKEN_KEY);
}
