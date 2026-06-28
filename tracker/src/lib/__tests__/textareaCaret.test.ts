import { describe, expect, it } from "vitest";

import { getTextareaCaretRect } from "@/lib/textareaCaret";

describe("getTextareaCaretRect", () => {
  it("returns viewport coordinates for the caret position", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "Hi @raph";
    textarea.style.width = "320px";
    textarea.style.height = "120px";
    textarea.style.padding = "8px";
    textarea.style.font = "14px/20px sans-serif";
    document.body.appendChild(textarea);

    textarea.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 50,
        width: 320,
        height: 120,
        right: 370,
        bottom: 220,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    const rect = getTextareaCaretRect(textarea, textarea.value.length);

    expect(rect).not.toBeNull();
    expect(rect?.top).toBeGreaterThanOrEqual(100);
    expect(rect?.left).toBeGreaterThanOrEqual(50);
    expect(rect?.height).toBeGreaterThan(0);

    document.body.removeChild(textarea);
  });
});
