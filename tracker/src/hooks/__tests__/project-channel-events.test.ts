import { describe, expect, it, vi } from "vitest";

import { bindProjectEvents, isProjectRealtimeEventName, projectTopic } from "@/services/phoenix/channels";

describe("project channel helpers", () => {
  it("builds project topics with validation", () => {
    expect(projectTopic("macro-markets")).toBe("project:macro-markets");
    expect(() => projectTopic(" ")).toThrow(/projectSlug/);
  });

  it("recognizes supported realtime event names", () => {
    expect(isProjectRealtimeEventName("issue_moved")).toBe(true);
    expect(isProjectRealtimeEventName("terminal_output")).toBe(false);
  });

  it("binds all project event handlers", () => {
    const on = vi.fn();
    bindProjectEvents({ on } as never, vi.fn());

    expect(on.mock.calls.map((call) => call[0])).toEqual([
      "issue_created",
      "issue_updated",
      "issue_moved",
      "comment_created",
      "blocker_changed",
    ]);
  });

  it("normalizes channel event payloads before invoking handlers", () => {
    const callbacks: Record<string, (payload: unknown) => void> = {};
    const on = vi.fn((event: string, callback: (payload: unknown) => void) => {
      callbacks[event] = callback;
    });
    const handler = vi.fn();

    bindProjectEvents({ on } as never, handler);
    callbacks.issue_updated({
      issue: {
        id: 123,
        identifier: "MAC-1",
        project_slug: "macro-markets",
        status: { name: "In Progress" },
        title: "Realtime issue",
        description: null,
        priority: null,
        position: 0,
        inserted_at: "2026-05-27T01:00:00Z",
        updated_at: "2026-05-27T02:00:00Z",
      },
    });

    expect(handler).toHaveBeenCalledWith("issue_updated", {
      issue: expect.objectContaining({
        id: "123",
        projectSlug: "macro-markets",
        status: "In Progress",
      }),
    });
  });
});
