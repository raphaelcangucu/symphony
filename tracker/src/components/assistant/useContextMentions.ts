import { useCallback, useState } from "react";

import { mentionToken, type MentionRef } from "@/components/assistant/contextMentions";

const MENTION_PATTERN = /(^|\s)@([\w./-]*)$/;

export interface ContextMentionState {
  open: boolean;
  query: string;
  mentionStart: number;
  handleChange: (value: string, cursor: number) => void;
  selectMention: (entity: MentionRef) => string | null;
  close: () => void;
}

export function useContextMentions(value: string): ContextMentionState {
  const [mentionStart, setMentionStart] = useState(-1);
  const [query, setQuery] = useState("");

  const open = mentionStart >= 0;

  const handleChange = useCallback((next: string, cursor: number) => {
    const safeCursor = Math.max(0, Math.min(cursor, next.length));
    const prefix = next.slice(0, safeCursor);
    const match = prefix.match(MENTION_PATTERN);

    if (!match) {
      setMentionStart(-1);
      setQuery("");
      return;
    }

    setMentionStart(safeCursor - match[2].length - 1);
    setQuery(match[2]);
  }, []);

  const selectMention = useCallback(
    (entity: MentionRef) => {
      if (mentionStart < 0 || !entity?.id) return null;

      const before = value.slice(0, mentionStart);
      const afterStart = mentionStart + 1 + query.length;
      const after = value.slice(afterStart);
      const next = `${before}${mentionToken(entity)} ${after}`;

      setMentionStart(-1);
      setQuery("");
      return next;
    },
    [value, mentionStart, query],
  );

  const close = useCallback(() => {
    setMentionStart(-1);
    setQuery("");
  }, []);

  return { open, query, mentionStart, handleChange, selectMention, close };
}
