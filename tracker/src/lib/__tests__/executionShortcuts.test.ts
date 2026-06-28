import { describe, expect, it } from "vitest";

import { EXECUTION_SHORTCUTS, matchShortcut } from "@/lib/executionShortcuts";

describe("EXECUTION_SHORTCUTS", () => {
  it("has unique ids with non-empty keys and labelKeys", () => {
    const ids = EXECUTION_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of EXECUTION_SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.labelKey.length).toBeGreaterThan(0);
    }
  });
});

describe("matchShortcut", () => {
  it("maps mod+enter to resume", () => {
    expect(matchShortcut({ key: "Enter", metaKey: true })).toBe("resume");
    expect(matchShortcut({ key: "Enter", ctrlKey: true })).toBe("resume");
  });

  it("maps mod+shift+r to restart", () => {
    expect(matchShortcut({ key: "r", metaKey: true, shiftKey: true })).toBe("restart");
  });

  it("maps mod+. to stop", () => {
    expect(matchShortcut({ key: ".", ctrlKey: true })).toBe("stop");
  });

  it("requires the mod key", () => {
    expect(matchShortcut({ key: "Enter" })).toBeNull();
    expect(matchShortcut({ key: "r", shiftKey: true })).toBeNull();
  });

  it("returns null for unmapped combos", () => {
    expect(matchShortcut({ key: "z", metaKey: true })).toBeNull();
  });

  it("does not confuse mod+r with mod+shift+r", () => {
    expect(matchShortcut({ key: "r", metaKey: true })).toBeNull();
  });
});
