/**
 * Shared time/duration formatting helpers. Single source of truth for the
 * previously duplicated `formatRuntime`/`formatElapsed`/`formatDate` helpers
 * scattered across session lists, observability, evidence and assistant views.
 */

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function elapsedSecondsSince(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 1000));
}

/**
 * Compact runtime display: "45s", "3m 07s", "2h 05m".
 * Canonical replacement for the per-component `formatRuntime` copies.
 */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "-";
  const safe = Math.floor(seconds);
  if (safe < MINUTE_SECONDS) return `${safe}s`;
  const minutes = Math.floor(safe / MINUTE_SECONDS);
  const remainder = safe % MINUTE_SECONDS;
  if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Verbose clock display used by goal indicators: "1h 2m 3s", "4m 5s", "6s". */
export function formatGoalClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / HOUR_SECONDS);
  const m = Math.floor((safe % HOUR_SECONDS) / MINUTE_SECONDS);
  const s = safe % MINUTE_SECONDS;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Ticking clock display: "4:07". Used by live working indicators. */
export function formatClockElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / MINUTE_SECONDS);
  const seconds = totalSeconds % MINUTE_SECONDS;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Full locale date-time; falls back to the raw value when unparseable. */
export function formatFullDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Short "Jan 5" style date; falls back to the raw value when unparseable. */
export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Short "Jan 5, 10:32 AM" style date-time with "-" fallback. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
