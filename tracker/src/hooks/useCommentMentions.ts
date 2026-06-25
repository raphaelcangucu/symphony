import { useCallback, useMemo, useState } from "react";

import { matchesPickerSearch } from "@/lib/pickerOptions";
import type { IssueAssigneeOption } from "@/types/issue";

const MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9_-]*)$/;

function assigneeLogin(option: IssueAssigneeOption): string | null {
  const login = option.login?.trim();
  return login || null;
}

export interface CommentMentionState {
  open: boolean;
  query: string;
  mentionStart: number;
  filteredAssignees: IssueAssigneeOption[];
  handleChange: (value: string, cursor: number) => void;
  selectMention: (login: string) => string | null;
  close: () => void;
}

export function useCommentMentions(
  body: string,
  assignees: IssueAssigneeOption[],
): CommentMentionState {
  const [mentionStart, setMentionStart] = useState(-1);
  const [query, setQuery] = useState("");

  const open = mentionStart >= 0;

  const filteredAssignees = useMemo(() => {
    if (!open) return [];
    const term = query.toLowerCase();
    return assignees.filter((option) => {
      const login = assigneeLogin(option);
      if (!login) return false;
      return matchesPickerSearch(term, login, option.name);
    });
  }, [assignees, open, query]);

  const handleChange = useCallback((value: string, cursor: number) => {
    const prefix = value.slice(0, cursor);
    const match = prefix.match(MENTION_PATTERN);

    if (!match) {
      setMentionStart(-1);
      setQuery("");
      return;
    }

    setMentionStart(cursor - match[2].length - 1);
    setQuery(match[2]);
  }, []);

  const selectMention = useCallback(
    (login: string) => {
      if (mentionStart < 0) return null;
      const trimmed = login.trim();
      if (!trimmed) return null;

      const before = body.slice(0, mentionStart);
      const afterStart = mentionStart + 1 + query.length;
      const after = body.slice(afterStart);
      const next = `${before}@${trimmed} ${after}`;

      setMentionStart(-1);
      setQuery("");
      return next;
    },
    [body, mentionStart, query],
  );

  const close = useCallback(() => {
    setMentionStart(-1);
    setQuery("");
  }, []);

  return {
    open,
    query,
    mentionStart,
    filteredAssignees,
    handleChange,
    selectMention,
    close,
  };
}
