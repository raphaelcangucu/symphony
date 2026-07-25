import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  profileQueryCacheKey,
  removeProfileQueries,
  restoreProfileQueries,
  saveProfileQueries,
} from "./query-cache";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    adapter: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
}

describe("profile query cache", () => {
  it("persists and restores only read models for the selected safe profile id", async () => {
    const source = new QueryClient();
    source.setQueryData(["tasks", "profile-1"], [{ id: "one" }]);
    source.setQueryData(["tasks", "profile-2"], [{ id: "two" }]);
    const cacheStorage = storage();

    await saveProfileQueries(source, "profile-1", cacheStorage.adapter);
    expect(cacheStorage.values.has(profileQueryCacheKey("profile-1"))).toBe(true);
    expect([...cacheStorage.values.values()].join(" ")).not.toContain("profile-2");

    const target = new QueryClient();
    await restoreProfileQueries(target, "profile-1", cacheStorage.adapter);
    expect(target.getQueryData(["tasks", "profile-1"])).toEqual([{ id: "one" }]);
    expect(target.getQueryData(["tasks", "profile-2"])).toBeUndefined();
  });

  it("removes every query belonging to a deleted profile without touching others", () => {
    const client = new QueryClient();
    client.setQueryData(["settings", "profile-1", "usage"], {});
    client.setQueryData(["tasks", "profile-1"], []);
    client.setQueryData(["tasks", "profile-2"], []);

    removeProfileQueries(client, "profile-1");

    expect(client.getQueryData(["settings", "profile-1", "usage"])).toBeUndefined();
    expect(client.getQueryData(["tasks", "profile-1"])).toBeUndefined();
    expect(client.getQueryData(["tasks", "profile-2"])).toEqual([]);
  });
});
