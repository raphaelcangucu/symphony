import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_TYPOGRAPHY_CLASS, chatTypographyStyle } from "@/components/assistant/chatTypography";

describe("chatTypography", () => {
  it("exports a stable class name for the shell scope", () => {
    expect(ASSISTANT_CHAT_TYPOGRAPHY_CLASS).toBe("assistant-chat-typography");
  });

  it("defines CSS variables for body, meta, mono, and title sizes", () => {
    const style = chatTypographyStyle();
    expect(style["--chat-body"]).toBe("12.5px");
    expect(style["--chat-meta"]).toBe("10.5px");
    expect(style["--chat-mono"]).toBe("10.5px");
    expect(style["--chat-title"]).toBe("12px");
    expect(style["--chat-body-leading"]).toBe("1.45");
  });
});
