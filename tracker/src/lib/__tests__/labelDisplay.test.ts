import { describe, expect, it } from "vitest";

import { isOpaqueLabelId, resolveLabelDisplay } from "@/lib/labelDisplay";
import type { IssueLabelOption } from "@/types/issue";

const options: IssueLabelOption[] = [
  { id: "LA_kwDOJHngx88AAAACmEYycw", name: "bug", color: "ff0000" },
  { id: "L2", name: "frontend", color: null },
];

describe("labelDisplay", () => {
  it("resolves a remote label id to its display name", () => {
    expect(resolveLabelDisplay("LA_kwDOJHngx88AAAACmEYycw", options)).toBe("bug");
  });

  it("keeps plain label names unchanged", () => {
    expect(resolveLabelDisplay("frontend", options)).toBe("frontend");
  });

  it("detects opaque GitHub label ids", () => {
    expect(isOpaqueLabelId("LA_kwDOJHngx88AAAACmEYycw")).toBe(true);
    expect(isOpaqueLabelId("bug")).toBe(false);
  });
});
