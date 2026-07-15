import { beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import {
  fetchWorkspaceInventory,
  subscribeWorkspaceInventory,
  updateWorkspaceDisplayName,
} from "@/services/worktrees";

vi.mock("@/config", () => ({ getTrackerToken: () => null }));
vi.mock("@/services/http", () => ({
  http: { delete: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
}));

function inventoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    path: "/workspaces/acme",
    kind: "project",
    classification: "active",
    reclaimable: false,
    work_present: true,
    removable: false,
    size_bytes: 10,
    repos: [],
    child_worktrees: [],
    ...overrides,
  };
}

describe("workspace inventory display names", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.unstubAllGlobals();
  });

  it("normalizes GET display names from snake_case wire format", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [
          inventoryEntry({ display_name: "Primary" }),
          inventoryEntry({ path: "/workspaces/second", display_name: "Second" }),
          inventoryEntry({ path: "/workspaces/unnamed" }),
          inventoryEntry({
            path: "/workspaces/malformed",
            display_name: 42,
          }),
        ],
        totals: { count: 4, size_bytes: 50, reclaimable_bytes: 0 },
      },
    });

    const inventory = await fetchWorkspaceInventory("acme");

    expect(inventory.entries.map(({ displayName }) => displayName)).toEqual([
      "Primary",
      "Second",
      null,
      null,
    ]);
  });

  it("normalizes snake_case, missing, and malformed SSE display names", () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    class MockEventSource {
      addEventListener = vi.fn((event: string, handler: (event: MessageEvent<string>) => void) => {
        listeners.set(event, handler);
      });
      close = vi.fn();
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    const onEntry = vi.fn();

    subscribeWorkspaceInventory("acme", { onEntry, onTotals: vi.fn() });
    [
      inventoryEntry({ display_name: "Streamed" }),
      inventoryEntry(),
      inventoryEntry({ display_name: 42 }),
    ].forEach((entry) => {
      listeners.get("entry")?.({
        data: JSON.stringify({ data: entry }),
      } as MessageEvent<string>);
    });

    expect(onEntry.mock.calls.map(([entry]) => entry.displayName)).toEqual([
      "Streamed",
      null,
      null,
    ]);
  });
});

describe("updateWorkspaceDisplayName", () => {
  beforeEach(() => vi.mocked(http.put).mockReset());

  it("puts the alias and normalizes the snake_case response", async () => {
    vi.mocked(http.put).mockResolvedValue({
      data: { data: { workspace_path: "/workspaces/acme", display_name: "My workspace" } },
    });

    const result = await updateWorkspaceDisplayName(
      "acme project",
      " /workspaces/acme ",
      " My workspace ",
    );

    expect(http.put).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/acme%20project/workspaces/display_names",
      { path: "/workspaces/acme", display_name: "My workspace" },
    );
    expect(result).toEqual({ workspacePath: "/workspaces/acme", displayName: "My workspace" });
  });

  it.each([
    [{ display_name: "Name" }, /workspacePath/i],
    [{ workspace_path: 42, display_name: "Name" }, /workspacePath/i],
    [{ workspace_path: "   ", display_name: "Name" }, /workspacePath/i],
    [{ workspace_path: "/workspaces/acme" }, /displayName/i],
    [{ workspace_path: "/workspaces/acme", display_name: 42 }, /displayName/i],
    [{ workspace_path: "/workspaces/acme", display_name: "   " }, /displayName/i],
  ])("rejects malformed update response %#", async (data, message) => {
    vi.mocked(http.put).mockResolvedValue({ data: { data } });

    await expect(
      updateWorkspaceDisplayName("acme", "/workspaces/acme", "Name"),
    ).rejects.toThrow(message);
  });

  it.each([
    ["", "/workspaces/acme", "Name", /project/i],
    ["acme", "", "Name", /workspacePath/i],
    ["acme", "relative/path", "Name", /absolute/i],
    ["acme", "/workspaces/\0acme", "Name", /NUL/i],
    ["acme", "/workspaces/acme", "", /displayName/i],
    ["acme", "/workspaces/acme", "a".repeat(121), /120/],
  ])("rejects invalid alias input %# before HTTP", async (slug, path, displayName, message) => {
    await expect(updateWorkspaceDisplayName(slug, path, displayName)).rejects.toThrow(
      message as RegExp,
    );
    expect(http.put).not.toHaveBeenCalled();
  });

  it("counts display-name graphemes", async () => {
    const familyEmoji = "👨‍👩‍👧‍👦";
    vi.mocked(http.put).mockResolvedValue({
      data: { data: { workspace_path: "/workspaces/acme", display_name: familyEmoji.repeat(120) } },
    });

    await expect(
      updateWorkspaceDisplayName("acme", "/workspaces/acme", familyEmoji.repeat(120)),
    ).resolves.toMatchObject({ workspacePath: "/workspaces/acme" });
  });
});
