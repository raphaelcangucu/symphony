import type { ReactNode } from "react";

import { useAssistantKbDocumentLinks } from "@/components/assistant/assistantKbDocumentLinksContext";
import { Markdown } from "@/components/ui/markdown";
import { linkifyExistingKbDocumentPaths } from "@/lib/kbDocumentLinks";
import { normalizeAssistantDocumentHref } from "@/services/threadDocuments";

interface AssistantMarkdownProps {
  content: string;
  onOpenDocumentPath?: (path: string) => void;
}

export function AssistantMarkdown({ content, onOpenDocumentPath }: AssistantMarkdownProps) {
  const kbLinks = useAssistantKbDocumentLinks();
  const openDocumentPath = onOpenDocumentPath ?? (kbLinks ? kbLinks.openDocument : undefined);
  const renderedContent =
    kbLinks && openDocumentPath ? linkifyExistingKbDocumentPaths(content, kbLinks.resolve) : content;

  return (
    <Markdown
      variant="assistant"
      className="min-w-0 text-inherit"
      linkRenderer={({ href, children }) =>
        renderAssistantDocumentLink(href, children, openDocumentPath, kbLinks?.resolve ?? null)
      }
    >
      {renderedContent}
    </Markdown>
  );
}

function renderAssistantDocumentLink(
  href: string | null | undefined,
  children: ReactNode,
  onOpenDocumentPath: AssistantMarkdownProps["onOpenDocumentPath"],
  resolve: ((rawReference: string) => { path: string; href: string } | null) | null,
) {
  if (!onOpenDocumentPath) return undefined;

  if (resolve) {
    const target = href ? resolve(href) : null;
    if (!target) return undefined;

    return (
      <a
        href={target.href}
        className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        onClick={(event) => {
          event.preventDefault();
          onOpenDocumentPath(target.path);
        }}
      >
        {children}
      </a>
    );
  }

  const documentPath = normalizeAssistantDocumentHref(href);
  if (!documentPath) return undefined;

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
