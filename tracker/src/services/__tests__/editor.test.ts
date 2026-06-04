import { describe, expect, it } from "vitest";

import { buildCursorUrlFromCodeServerUrl } from "@/services/editor";

describe("buildCursorUrlFromCodeServerUrl", () => {
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
});
