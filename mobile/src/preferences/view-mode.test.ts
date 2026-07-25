import { describe, expect, it, vi } from "vitest";

import { createViewModeStorage } from "./view-mode";

describe("view mode preference", () => {
  it("defaults to Orca and stores one device-wide value", async () => {
    const values = new Map<string, string>();
    const storage = createViewModeStorage({
      getItem: vi.fn(async (key) => values.get(key) ?? null),
      setItem: vi.fn(async (key, value) => void values.set(key, value)),
    });

    await expect(storage.load()).resolves.toBe("orca");
    await storage.save("codex");
    await expect(storage.load()).resolves.toBe("codex");
    expect(values.has("dev10x:mobile:view-mode")).toBe(true);
  });

  it("falls back to Orca for corrupt values", async () => {
    const storage = createViewModeStorage({
      getItem: async () => "other",
      setItem: async () => undefined,
    });
    await expect(storage.load()).resolves.toBe("orca");
  });
});
