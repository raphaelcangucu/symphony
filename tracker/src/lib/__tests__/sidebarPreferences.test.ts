import { describe, expect, it } from "vitest";

import {
  LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_MAX_ID_COLLECTION_SIZE,
  SIDEBAR_PREFERENCES_STORAGE_KEY,
  defaultSidebarPreferences,
  migrateSidebarPreferences,
  readSidebarPreferences,
  writeSidebarPreferences,
} from "@/lib/sidebarPreferences";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("sidebar preferences", () => {
  it("migrates the legacy collapse key only when v1 lacks a valid value", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    storage.setItem(
      SIDEBAR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, collapsed: "invalid", expandedProjectIds: [null, " demo "] }),
    );

    expect(readSidebarPreferences(storage)).toMatchObject({
      version: 1,
      collapsed: true,
      expandedProjectIds: ["demo"],
      sort: "activity",
    });

    storage.setItem(
      SIDEBAR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, collapsed: false }),
    );
    expect(readSidebarPreferences(storage).collapsed).toBe(false);
  });

  it("falls back independently for malformed fields and exact version mismatches", () => {
    const migrated = migrateSidebarPreferences({
      version: 1,
      collapsed: true,
      sort: "invalid",
      group: "status",
      filters: {
        statuses: ["active", "", 4],
        agents: ["cursor", "unknown"],
        showArchived: "yes",
        activityOnly: true,
      },
    });

    expect(migrated).toMatchObject({
      collapsed: true,
      sort: "activity",
      group: "status",
      filters: {
        statuses: ["active"],
        agents: ["cursor"],
        showArchived: false,
        activityOnly: true,
      },
    });
    expect(migrateSidebarPreferences({ version: 2, collapsed: true })).toEqual(
      defaultSidebarPreferences(),
    );
  });

  it("deduplicates, trims, rejects blank IDs, and caps collections", () => {
    const ids = Array.from(
      { length: SIDEBAR_MAX_ID_COLLECTION_SIZE + 5 },
      (_, index) => ` id-${index} `,
    );
    const migrated = migrateSidebarPreferences({
      version: 1,
      expandedProjectIds: ["", "same", " same ", ...ids],
    });

    expect(migrated.expandedProjectIds).toHaveLength(SIDEBAR_MAX_ID_COLLECTION_SIZE);
    expect(migrated.expandedProjectIds.slice(0, 2)).toEqual(["same", "id-0"]);
  });

  it("keeps only valid ISO timestamps and rejects prototype pollution keys", () => {
    const raw = JSON.parse(
      '{"version":1,"lastReadAtBySession":{"thread:1":"2026-07-13T10:00:00.000Z","bad":"yesterday","impossible":"2026-02-31T10:00:00Z","__proto__":"2026-07-13T10:00:00.000Z","constructor":"2026-07-13T10:00:00.000Z"}}',
    );

    expect(migrateSidebarPreferences(raw).lastReadAtBySession).toEqual({
      "thread:1": "2026-07-13T10:00:00.000Z",
    });
    expect(Object.getPrototypeOf(migrateSidebarPreferences(raw).lastReadAtBySession)).toBeNull();
  });

  it("survives malformed JSON and storage access failures", () => {
    const malformed = new MemoryStorage();
    malformed.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, "{");
    expect(readSidebarPreferences(malformed)).toEqual(defaultSidebarPreferences());

    const denied = {
      getItem(): string | null {
        throw new DOMException("denied");
      },
      setItem(): void {
        throw new DOMException("denied");
      },
    } as unknown as Storage;
    expect(readSidebarPreferences(denied)).toEqual(defaultSidebarPreferences());
    expect(writeSidebarPreferences(defaultSidebarPreferences(), denied)).toBe(false);
  });

  it("returns write success and persists a validated immutable snapshot", () => {
    const storage = new MemoryStorage();
    const preferences = defaultSidebarPreferences();
    preferences.expandedProjectIds.push(" demo ");

    expect(writeSidebarPreferences(preferences, storage)).toBe(true);
    preferences.expandedProjectIds.push("later");

    expect(readSidebarPreferences(storage).expandedProjectIds).toEqual(["demo"]);
  });

  it("never restores transient More reveals across a reload", () => {
    const storage = new MemoryStorage();
    const preferences = defaultSidebarPreferences();
    preferences.revealedProjectIds.push("gamba");
    preferences.revealedWorkspaceIds.push("workspace:gamba:main");

    expect(writeSidebarPreferences(preferences, storage)).toBe(true);

    const restored = readSidebarPreferences(storage);
    expect(restored.revealedProjectIds).toEqual([]);
    expect(restored.revealedWorkspaceIds).toEqual([]);
  });

  it("returns fresh defaults and never shares mutable collections", () => {
    const first = defaultSidebarPreferences();
    const second = defaultSidebarPreferences();
    first.filters.statuses.push("active");
    first.expandedWorkspaceIds.push("workspace:demo");

    expect(second.filters.statuses).toEqual([]);
    expect(second.expandedWorkspaceIds).toEqual([]);
  });
});
