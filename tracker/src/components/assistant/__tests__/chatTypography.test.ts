import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CHAT_FONT_FAMILY,
  ASSISTANT_CHAT_MESSAGE_TEXT_CLASS,
  ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
  CHAT_READING_COLUMN_CLASS,
  CHAT_READING_COLUMN_WIDE_CLASS,
  chatTypographyStyle,
} from "@/components/assistant/chatTypography";

describe("chatTypography", () => {
  it("exports a stable class name for the shell scope", () => {
    expect(ASSISTANT_CHAT_TYPOGRAPHY_CLASS).toBe("assistant-chat-typography");
  });

  it("exports a shared message-text class for composer, user, and assistant", () => {
    expect(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS).toBe("assistant-chat-message-text");
  });

  it("defines CSS variables for font, body, meta, mono, and title sizes", () => {
    const style = chatTypographyStyle();
    expect(style["--chat-font"]).toBe(ASSISTANT_CHAT_FONT_FAMILY);
    expect(style["--chat-body"]).toBe("13.5px");
    expect(style["--chat-meta"]).toBe("11px");
    expect(style["--chat-mono"]).toBe("11.5px");
    expect(style["--chat-title"]).toBe("12.5px");
    expect(style["--chat-body-leading"]).toBe("1.55");
  });

  it("exports the shared centered reading column classes", () => {
    expect(CHAT_READING_COLUMN_CLASS).toContain("mx-auto");
    expect(CHAT_READING_COLUMN_CLASS).toContain("max-w-3xl");
    expect(CHAT_READING_COLUMN_WIDE_CLASS).toContain("80rem");
  });
});
