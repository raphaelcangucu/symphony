import { describe, expect, it } from "vitest";

import { createDiagnosticLog, sanitizeDiagnosticValue } from "./diagnostic-log";

describe("sanitizeDiagnosticValue", () => {
  it("redacts secrets from URLs, headers, bodies, and free-form messages", () => {
    const sanitized = sanitizeDiagnosticValue(
      {
        url: "https://demo.test/api?token=secret-token&project=symphony",
        headers: {
          Authorization: "Bearer secret-token",
          Cookie: "session=secret-token",
          Accept: "application/json",
        },
        body: {
          profile_id: "profile-1",
          token: "secret-token",
          nested: { password: "secret-token" },
        },
        message: "Bearer secret-token was rejected",
      },
      ["secret-token"],
    );

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("profile-1");
    expect(serialized).toContain("symphony");
  });
});

describe("createDiagnosticLog", () => {
  it("keeps only the newest bounded entries and never returns mutable state", () => {
    let tick = 0;
    const log = createDiagnosticLog({
      limit: 2,
      now: () => `2026-07-24T00:00:0${tick++}Z`,
      createId: () => `entry-${tick}`,
    });

    log.record({ scope: "request", event: "one", details: {} });
    log.record({ scope: "socket", event: "two", details: {} });
    log.record({ scope: "system", event: "three", details: {} });

    expect(log.list().map((entry) => entry.event)).toEqual(["three", "two"]);
    const snapshot = log.list();
    snapshot.pop();
    expect(log.list()).toHaveLength(2);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const log = createDiagnosticLog();
    let updates = 0;
    const subscription = log.subscribe(() => {
      updates += 1;
    });

    log.record({ scope: "system", event: "connected", details: {} });
    subscription.remove();
    log.clear();

    expect(updates).toBe(1);
  });
});
