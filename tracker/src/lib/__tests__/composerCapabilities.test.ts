import { describe, expect, it } from "vitest";

import {
  composerCapabilitiesFor,
  executionModeForPermission,
  permissionLevelForMode,
  withBackendCapabilities,
} from "@/lib/composerCapabilities";

describe("composerCapabilitiesFor", () => {
  it("uses full access as the provider-neutral fallback", () => {
    expect(composerCapabilitiesFor("codex").defaultPermission).toBe(
      "full_access",
    );
  });

  it.each(["codex", "claude", "cursor", "opencode"] as const)(
    "exposes stable permission rows for %s",
    (agent) => {
      expect(
        composerCapabilitiesFor(agent).permissions.map((entry) => entry.id),
      ).toEqual([
        "ask_for_approval",
        "approve_for_me",
        "full_access",
      ]);
    },
  );

  it("derives steer and native goal support from provider capabilities", () => {
    expect(composerCapabilitiesFor("codex")).toMatchObject({
      steer: true,
      nativeGoal: true,
    });
    expect(composerCapabilitiesFor("claude")).toMatchObject({
      steer: false,
      nativeGoal: true,
    });
    expect(composerCapabilitiesFor("cursor")).toMatchObject({
      steer: false,
      nativeGoal: false,
    });
  });

  it("keeps unavailable permission rows visible when runtime capabilities override support", () => {
    const capabilities = withBackendCapabilities(
      composerCapabilitiesFor("cursor"),
      {
        availablePermissions: ["ask_for_approval", "full_access"],
        steer: false,
      },
    );

    expect(capabilities.permissions).toContainEqual({
      id: "approve_for_me",
      available: false,
      unavailableReason: "Unavailable for this agent",
    });
  });
});

describe("permission transport mapping", () => {
  it("maps legacy execution modes without leaking yolo into the UI contract", () => {
    expect(permissionLevelForMode("plan")).toBe("ask_for_approval");
    expect(permissionLevelForMode("build")).toBe("approve_for_me");
    expect(permissionLevelForMode("yolo")).toBe("full_access");
    expect(executionModeForPermission("full_access")).toBe("yolo");
  });
});
