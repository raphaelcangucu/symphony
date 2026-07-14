import type { CSSProperties } from "react";

export const ASSISTANT_CHAT_TYPOGRAPHY_CLASS = "assistant-chat-typography";

type ChatTypographyVars = CSSProperties & {
  "--chat-body": string;
  "--chat-meta": string;
  "--chat-mono": string;
  "--chat-title": string;
  "--chat-body-leading": string;
};

export function chatTypographyStyle(): ChatTypographyVars {
  return {
    "--chat-body": "12.5px",
    "--chat-meta": "10.5px",
    "--chat-mono": "10.5px",
    "--chat-title": "12px",
    "--chat-body-leading": "1.45",
  };
}
