import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import {
  isTrackerAuthenticatedMediaUrl,
  isVideoAttachmentSource,
} from "@/services/attachments";
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
  variant?: "default" | "assistant";
}

export function Markdown({
  children,
  className,
  linkRenderer,
  variant = "default",
}: MarkdownProps) {
  const { t } = useTranslation();
  const assistant = variant === "assistant";

  return (
    <div
      className={cn(
        "markdown-body",
        assistant
          ? "markdown-body--assistant"
          : "text-sm leading-6 text-foreground/90",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren, href, node }) => {
            if (isAuthenticatedVideoHref(href)) {
              const label = linkText(linkChildren) || t("issue.attachments.defaultVideo");
              return (
                <AttachmentVideo
                  src={href}
                  label={label}
                  className="my-2 max-h-80 w-auto max-w-full rounded-lg border object-contain"
                />
              );
            }

            if (containsBlockMedia(node)) return <>{linkChildren}</>;

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
          img: ({ src, alt }) => {
            const source = typeof src === "string" ? src : "";
            const label = typeof alt === "string" && alt.length > 0 ? alt : t("assistant.panel.attachmentLabel.default");

            if (isTrackerAuthenticatedMediaUrl(source)) {
              return (
                <AttachmentImage
                  src={source}
                  alt={label}
                  className="max-h-80 w-auto max-w-full object-contain"
                  layout="inline"
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
          p: ({ children: paragraphChildren, node }) =>
            containsBlockMedia(node) ? (
              <div className="markdown-media-block">{paragraphChildren}</div>
            ) : (
              <p>{paragraphChildren}</p>
            ),
          table: ({ children: tableChildren }) =>
            assistant ? (
              <div className="assistant-markdown-table">
                <table>{tableChildren}</table>
              </div>
            ) : (
              <table>{tableChildren}</table>
            ),
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

function containsBlockMedia(node: unknown): boolean {
  if (!isRecord(node)) return false;
  const tagName = node.tagName;
  if (tagName === "img") {
    return isTrackerAuthenticatedMediaUrl(nodeProperty(node, "src"));
  }
  if (tagName === "a" && isAuthenticatedVideoHref(nodeProperty(node, "href"))) {
    return true;
  }
  if (!Array.isArray(node.children)) return false;
  return node.children.some(containsBlockMedia);
}

function isAuthenticatedVideoHref(
  href: string | null | undefined,
): href is string {
  return Boolean(
    href &&
      isTrackerAuthenticatedMediaUrl(href) &&
      isVideoAttachmentSource(href),
  );
}

function nodeProperty(
  node: Record<string, unknown>,
  propertyName: string,
): string | null {
  if (!isRecord(node.properties)) return null;
  const value = node.properties[propertyName];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
