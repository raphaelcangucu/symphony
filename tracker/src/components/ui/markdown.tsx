import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { isInternalAttachmentUrl, isVideoAttachmentSource } from "@/services/attachments";
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

            if (href && isInternalAttachmentUrl(href) && isVideoAttachmentSource(href)) {
              const label = linkText(linkChildren) || "video";
              return (
                <AttachmentVideo
                  src={href}
                  label={label}
                  className="my-2 max-h-80 w-auto max-w-full rounded-lg border object-contain"
                />
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const source = typeof src === "string" ? src : "";
            const label = typeof alt === "string" && alt.length > 0 ? alt : "attachment";

            if (isInternalAttachmentUrl(source)) {
              return (
                <AttachmentImage
                  src={source}
                  alt={label}
                  className="my-2 max-h-80 w-auto max-w-full object-contain"
                />
              );
            }

            if (!source) return null;

            return (
              <img
                src={source}
                alt={label}
                loading="lazy"
                className="my-2 max-h-80 w-auto max-w-full rounded-lg border object-contain"
              />
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function linkText(children: ReactNode): string {
  if (typeof children === "string") return children.trim();
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(linkText).join("").trim();
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return linkText(props?.children);
  }
  return "";
}
