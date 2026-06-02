import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { isAssistantWorkspaceMarkdownHref } from "@/services/threadDocuments";
import { cn } from "@/lib/utils";

interface MarkdownLinkProps {
  href?: string | null;
  children: ReactNode;
}

interface MarkdownProps {
  children: string;
  className?: string;
  linkRenderer?: (props: MarkdownLinkProps) => ReactElement | undefined;
}

export function Markdown({ children, className, linkRenderer }: MarkdownProps) {
  return (
    <div className={cn("markdown-body text-sm leading-6 text-foreground/90", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren, href }) => {
            const custom = linkRenderer?.({ href, children: linkChildren });
            if (custom) return custom;

            if (isAssistantWorkspaceMarkdownHref(href)) {
              return <span className="font-medium text-primary underline underline-offset-2">{linkChildren}</span>;
            }

            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
