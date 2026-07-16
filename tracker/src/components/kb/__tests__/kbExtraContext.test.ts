import { describe, expect, it } from "vitest";

import { buildKbExtraContext } from "@/components/kb/kbExtraContext";

describe("buildKbExtraContext", () => {
  it("returns the kb surface snapshot", () => {
    expect(
      buildKbExtraContext({
        repoSlug: "apps~web",
        pagePath: "guide.md",
        title: "Guide",
        body: "# Guide\n\nHello",
        selection: "Hello",
      }),
    ).toEqual({
      surface: "kb",
      kb: {
        repoSlug: "apps~web",
        pagePath: "guide.md",
        title: "Guide",
        body: "# Guide\n\nHello",
        selection: "Hello",
      },
    });
  });
});
