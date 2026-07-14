import type { ReactNode } from "react";

import { Markdown } from "@/components/ui/markdown";
import { normalizeAssistantDocumentHref } from "@/services/threadDocuments";

interface AssistantMarkdownProps {
  content: string;
  onOpenDocumentPath?: (path: string) => void;
}

export function AssistantMarkdown({ content, onOpenDocumentPath }: AssistantMarkdownProps) {
  return (
    <Markdown
      variant="assistant"
      className="min-w-0 text-inherit"
      linkRenderer={({ href, children }) =>
        renderAssistantDocumentLink(href, children, onOpenDocumentPath)
      }
    >
      {content}
    </Markdown>
  );
}

function renderAssistantDocumentLink(
  href: string | null | undefined,
  children: ReactNode,
  onOpenDocumentPath: AssistantMarkdownProps["onOpenDocumentPath"],
) {
  const documentPath = normalizeAssistantDocumentHref(href);
  if (!documentPath || !onOpenDocumentPath) return undefined;

  return (
    <button
      type="button"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      onClick={() => onOpenDocumentPath(documentPath)}
    >
      {children}
    </button>
  );
}
