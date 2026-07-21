import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCursorUrlFromCodeServerUrl,
  fetchProjectEditorTargets,
  fetchThreadEditorTargets,
} from "@/services/editor";
import { http } from "@/services/http";

describe("buildCursorUrlFromCodeServerUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("derives cursor:// from a code-server folder URL", () => {
    const codeServer =
      "http://127.0.0.1:4002/?folder=%2Fhome%2Fuser%2Fworkspaces%2FMAC-1";

    expect(buildCursorUrlFromCodeServerUrl(codeServer)).toBe(
      "cursor://file//home/user/workspaces/MAC-1",
    );
  });

  it("returns null when the code-server URL has no folder", () => {
    expect(buildCursorUrlFromCodeServerUrl("http://127.0.0.1:4002/")).toBeNull();
  });

  it("fetches project-level editor targets", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          available: false,
          url: null,
          reason: "disabled",
          cursor_desktop: {
            available: true,
            url: "cursor://file//tmp/macro-markets",
            reason: null,
          },
        },
      },
    });

    await expect(fetchProjectEditorTargets("macro-markets")).resolves.toEqual({
      browser: { available: false, url: null, reason: "disabled" },
      cursorDesktop: { available: true, url: "cursor://file//tmp/macro-markets", reason: null },
    });
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/editor");
  });

  it("fetches thread-level editor targets", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          available: true,
          url: "https://editor.example.com/?folder=%2Ftmp%2Fthread-42",
          reason: null,
          cursor_desktop: {
            available: true,
            url: "cursor://file//tmp/thread-42",
            reason: null,
          },
        },
      },
    });

    await expect(fetchThreadEditorTargets(42)).resolves.toEqual({
      browser: {
        available: true,
        url: "https://editor.example.com/?folder=%2Ftmp%2Fthread-42",
        reason: null,
      },
      cursorDesktop: {
        available: true,
        url: "cursor://file//tmp/thread-42",
        reason: null,
      },
    });
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/editor");
  });
});
