import { describe, expect, it } from "vitest";
import { isToolFamily } from "@/lib/toolCallPresentation";

describe("toolCallPresentation", () => {
  it("recognizes known families", () => {
    expect(isToolFamily("command")).toBe(true);
    expect(isToolFamily("kb")).toBe(true);
    expect(isToolFamily("not-a-family")).toBe(false);
  });
});
