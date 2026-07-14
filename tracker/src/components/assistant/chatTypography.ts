import type { CSSProperties } from "react";

export const ASSISTANT_CHAT_TYPOGRAPHY_CLASS = "assistant-chat-typography";

/** Shared prose face for composer input, user bubbles, and assistant replies. */
export const ASSISTANT_CHAT_MESSAGE_TEXT_CLASS = "assistant-chat-message-text";

export const ASSISTANT_CHAT_FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Centered measure shared by interactive assistant chat and autonomous execution. */
export const CHAT_READING_COLUMN_CLASS =
  "mx-auto w-full max-w-3xl px-4 sm:px-5 xl:max-w-4xl 2xl:max-w-5xl 2xl:px-6";

export const CHAT_READING_COLUMN_WIDE_CLASS = "mx-auto max-w-[min(100%,80rem)] px-4 lg:px-6";

/** Cap for individual user bubbles — wide enough to reduce wrap on large columns. */
export const CHAT_USER_BUBBLE_MAX_WIDTH_CLASS = "max-w-[min(92%,48rem)]";

type ChatTypographyVars = CSSProperties & {
  "--chat-font": string;
  "--chat-body": string;
  "--chat-meta": string;
  "--chat-mono": string;
  "--chat-title": string;
  "--chat-body-leading": string;
};

export function chatTypographyStyle(): ChatTypographyVars {
  return {
    "--chat-font": ASSISTANT_CHAT_FONT_FAMILY,
    // Slightly above dense chrome, still proportional to the rest of Tracker UI.
    "--chat-body": "13.5px",
    "--chat-meta": "11px",
    "--chat-mono": "11.5px",
    "--chat-title": "12.5px",
    "--chat-body-leading": "1.55",
  };
}
