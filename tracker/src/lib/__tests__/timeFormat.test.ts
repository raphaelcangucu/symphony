import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { formatRelativeTime } from "@/lib/timeFormat";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-09T15:00:00.000Z");

  it("returns '-' for null, undefined, and invalid", () => {
    expect(formatRelativeTime(null, now)).toBe("-");
    expect(formatRelativeTime(undefined, now)).toBe("-");
    expect(formatRelativeTime("not-a-date", now)).toBe("-");
  });

  it("uses justNow under 5 seconds", () => {
    expect(formatRelativeTime("2026-07-09T14:59:57.000Z", now)).toBe(i18n.t("time.relative.justNow"));
  });

  it("formats seconds, minutes, hours, and days", () => {
    expect(formatRelativeTime("2026-07-09T14:59:30.000Z", now)).toBe(
      i18n.t("time.relative.seconds", { count: 30 }),
    );
    expect(formatRelativeTime("2026-07-09T14:45:00.000Z", now)).toBe(
      i18n.t("time.relative.minutes", { count: 15 }),
    );
    expect(formatRelativeTime("2026-07-09T13:00:00.000Z", now)).toBe(
      i18n.t("time.relative.hours", { count: 2 }),
    );
    expect(formatRelativeTime("2026-07-07T15:00:00.000Z", now)).toBe(
      i18n.t("time.relative.days", { count: 2 }),
    );
  });

  it("clamps future timestamps to justNow", () => {
    expect(formatRelativeTime("2026-07-09T16:00:00.000Z", now)).toBe(i18n.t("time.relative.justNow"));
  });
});
