import { useCallback, useRef } from "react";

import {
  expandComposerMentions,
  parseMentionTokens,
  type ResolvedMention,
} from "@/components/assistant/contextMentions";

export interface ComposerMentions {
  /** Cache a resolved entity so later dispatches can expand its token. */
  rememberMention: (entity: ResolvedMention) => void;
  /** Expand inline `@type:id` tokens using previously resolved entities. */
  expandMentions: (text: string) => string;
}

/**
 * Caches resolved mention entities by token so dispatched instructions can
 * expand inline `@type:id` tokens into a `## Context` block, even across
 * re-renders. Shared by the assistant panel and the execution composer.
 */
export function useComposerMentions(): ComposerMentions {
  const resolvedMentionsRef = useRef<Map<string, ResolvedMention>>(new Map());

  const rememberMention = useCallback((entity: ResolvedMention) => {
    resolvedMentionsRef.current.set(`${entity.type}:${entity.id}`, entity);
  }, []);

  const expandMentions = useCallback((text: string): string => {
    const tokens = parseMentionTokens(text);
    if (tokens.length === 0) return text;
    const resolved = tokens.map(
      (token) => resolvedMentionsRef.current.get(`${token.type}:${token.id}`) ?? token,
    );
    return expandComposerMentions(text, resolved);
  }, []);

  return { rememberMention, expandMentions };
}
