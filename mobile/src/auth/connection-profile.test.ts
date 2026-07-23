import { describe, expect, it } from "vitest";

import {
  createConnectionProfile,
  normalizeTrackerOrigin,
  parseConnectionDeepLink,
  redactSecret,
} from "./connection-profile";

describe("normalizeTrackerOrigin", () => {
  it("normalizes a tracker page URL to its server origin", () => {
    expect(normalizeTrackerOrigin(" https://demo.test/tracker/ ")).toBe(
      "https://demo.test",
    );
    expect(
      normalizeTrackerOrigin(
        "https://demo.test/tracker/projects/demo/workspaces",
      ),
    ).toBe("https://demo.test");
  });

  it("keeps an explicit reverse-proxy base path", () => {
    expect(normalizeTrackerOrigin("https://demo.test/symphony/")).toBe(
      "https://demo.test/symphony",
    );
    expect(
      normalizeTrackerOrigin("https://demo.test/symphony/tracker/projects"),
    ).toBe("https://demo.test/symphony");
  });

  it("rejects unsupported schemes and embedded credentials", () => {
    expect(() => normalizeTrackerOrigin("javascript:alert(1)")).toThrow(
      "Only http and https tracker URLs are supported",
    );
    expect(() =>
      normalizeTrackerOrigin("https://user:password@demo.test"),
    ).toThrow("Tracker URLs must not contain credentials");
  });

  it("rejects fragments and missing hosts", () => {
    expect(() => normalizeTrackerOrigin("https://demo.test/#token")).toThrow(
      "Tracker URLs must not contain fragments",
    );
    expect(() => normalizeTrackerOrigin("https:///tracker")).toThrow(
      "Tracker URL must include a host",
    );
  });
});

describe("parseConnectionDeepLink", () => {
  it("parses and normalizes a complete connection link", () => {
    expect(
      parseConnectionDeepLink(
        "symphony://connect?url=https%3A%2F%2Fdemo.test%2Ftracker&token=secret",
      ),
    ).toEqual({
      origin: "https://demo.test",
      token: "secret",
    });
  });

  it("rejects other routes and missing connection secrets", () => {
    expect(() =>
      parseConnectionDeepLink(
        "symphony://session/42?url=https%3A%2F%2Fdemo.test&token=secret",
      ),
    ).toThrow("Unsupported Symphony connection link");
    expect(() =>
      parseConnectionDeepLink(
        "symphony://connect?url=https%3A%2F%2Fdemo.test&token=%20",
      ),
    ).toThrow("Connection link must include a tracker token");
  });
});

describe("redactSecret", () => {
  it("redacts every direct occurrence without changing unrelated text", () => {
    expect(
      redactSecret(
        "Bearer secret-value failed; token=secret-value",
        "secret-value",
      ),
    ).toBe("Bearer [REDACTED] failed; token=[REDACTED]");
    expect(redactSecret("network failed", "secret-value")).toBe(
      "network failed",
    );
  });

  it("does not treat a blank value as a replacement pattern", () => {
    expect(redactSecret("network failed", "   ")).toBe("network failed");
  });
});

describe("createConnectionProfile", () => {
  it("creates stable, normalized non-secret profile metadata", () => {
    const profile = createConnectionProfile(
      {
        name: "  Production  ",
        origin: "https://demo.test/tracker",
      },
      {
        createId: () => "profile-uuid",
        now: () => "2026-07-23T12:00:00.000Z",
      },
    );

    expect(profile).toEqual({
      id: "profile-uuid",
      name: "Production",
      origin: "https://demo.test",
      createdAt: "2026-07-23T12:00:00.000Z",
      lastConnectedAt: null,
    });
    expect(profile).not.toHaveProperty("token");
  });

  it("requires a visible profile name", () => {
    expect(() =>
      createConnectionProfile(
        { name: " ", origin: "https://demo.test" },
        {
          createId: () => "profile-uuid",
          now: () => "2026-07-23T12:00:00.000Z",
        },
      ),
    ).toThrow("Connection name is required");
  });
});
