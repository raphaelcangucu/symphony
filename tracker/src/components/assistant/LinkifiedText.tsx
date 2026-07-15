import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const BARE_HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[),.;:!?]+$/;

interface LinkifiedTextProps {
  text: string;
  className?: string;
  linkClassName?: string;
}

export function LinkifiedText({ text, className, linkClassName }: LinkifiedTextProps) {
  return <p className={cn("whitespace-pre-wrap", className)}>{renderLinkifiedNodes(text, linkClassName)}</p>;
}

function renderLinkifiedNodes(text: string, linkClassName?: string): ReactNode[] {
  if (typeof text !== "string" || text.length === 0) {
    return [text];
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(BARE_HTTP_URL_PATTERN)) {
    const rawMatch = match[0];
    const matchStart = match.index ?? 0;
    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }

    const { href, trailing } = splitTrailingPunctuation(rawMatch);
    nodes.push(
      <a
        key={`url-${matchIndex}-${matchStart}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "underline underline-offset-2 decoration-white/70 hover:decoration-white",
          linkClassName,
        )}
      >
        {href}
      </a>,
    );
    if (trailing.length > 0) {
      nodes.push(trailing);
    }

    lastIndex = matchStart + rawMatch.length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function splitTrailingPunctuation(rawUrl: string): { href: string; trailing: string } {
  const trailingMatch = rawUrl.match(TRAILING_PUNCTUATION_PATTERN);
  if (!trailingMatch) {
    return { href: rawUrl, trailing: "" };
  }

  const trailing = trailingMatch[0];
  return {
    href: rawUrl.slice(0, rawUrl.length - trailing.length),
    trailing,
  };
}
