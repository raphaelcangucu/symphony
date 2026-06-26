import { trackerPath } from "@/services/http";

export interface KbAssetContext {
  projectSlug: string;
  repoSlug: string;
  pagePath: string;
}

const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
/** Matches an entire `<img …>` tag so aligned/sized images (serialized as HTML) get the same asset-URL rewriting as Markdown images. */
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_ATTR_RE = /(\bsrc\s*=\s*)(["'])(.*?)\2/i;

function rewriteImgTagSrc(tag: string, transform: (src: string) => string): string {
  return tag.replace(IMG_SRC_ATTR_RE, (_match, prefix: string, quote: string, src: string) => {
    return `${prefix}${quote}${transform(src)}${quote}`;
  });
}

/** Mirrors the backend `@asset_extensions` in `knowledge_base/tree.ex`. */
const IMAGE_ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"] as const;

export function isKbImageAssetPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.trim().toLowerCase();
  return IMAGE_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** File name without directory or extension, e.g. `assets/queue-config.png` -> `queue-config`. */
export function assetBaseName(path: string): string {
  const file = path.split("/").filter((segment) => segment.length > 0).pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Suggests a friendly default name for a pasted image, derived from the current
 * page's file name (e.g. editing `images/daemon-config.md` suggests
 * `daemon-config`). The backend slugs and de-duplicates the final value.
 */
export function suggestAssetName(pagePath: string | null | undefined): string {
  if (!pagePath) return "image";
  const base = assetBaseName(pagePath).replace(/[-_]+/g, " ").trim();
  return base.length > 0 ? base : "image";
}

function encodeAssetPath(assetPath: string): string {
  return assetPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export function kbAssetApiPath(projectSlug: string, repoSlug: string, assetPath: string): string {
  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/kb/repos/${encodeURIComponent(repoSlug)}/assets/${encodeAssetPath(assetPath)}`,
  );
}

function pageDirectory(pagePath: string): string {
  const trimmed = pagePath.trim();
  if (!trimmed.includes("/")) return "";
  return trimmed.slice(0, trimmed.lastIndexOf("/"));
}

function relativeAssetLink(pagePath: string, assetPath: string): string {
  const pageDir = pageDirectory(pagePath);
  if (pageDir.length === 0) return assetPath;
  return relativePath(pageDir, assetPath);
}

function relativePath(fromDir: string, targetPath: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = targetPath.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  const ups = from.length - shared;
  const parts = [...Array.from({ length: ups }, () => ".."), ...to.slice(shared)];
  return parts.join("/");
}

function resolveRelativeAssetPath(pagePath: string, src: string): string {
  if (!src.includes("/")) return src;
  const pageDir = pageDirectory(pagePath);
  const base = pageDir.length > 0 ? `${pageDir}/` : "";
  try {
    return new URL(src, `https://kb.local/${base}`).pathname.replace(/^\//, "");
  } catch {
    return src;
  }
}

function isExternalAssetSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:") ||
    src.startsWith("data:")
  );
}

export function resolveKbAssetUrl(src: string, ctx: KbAssetContext): string {
  if (!src || isExternalAssetSrc(src)) return src;
  if (src.includes("/kb/repos/") && src.includes("/assets/")) return src;
  const absolute = src.startsWith("assets/") ? src : resolveRelativeAssetPath(ctx.pagePath, src);
  return kbAssetApiPath(ctx.projectSlug, ctx.repoSlug, absolute);
}

export function absolutizeKbAssetUrl(src: string, ctx: KbAssetContext): string | null {
  const marker = "/assets/";
  const idx = src.indexOf(marker);
  if (idx === -1) return null;

  const apiPrefix = kbAssetApiPath(ctx.projectSlug, ctx.repoSlug, "");
  if (!src.startsWith(apiPrefix) && !src.includes(`${marker}`)) return null;

  const encoded = src.slice(idx + marker.length).split("?")[0]?.split("#")[0] ?? "";
  const assetPath = decodeURIComponent(encoded);
  if (!assetPath.startsWith("assets/")) return null;
  return relativeAssetLink(ctx.pagePath, assetPath);
}

function editorizeSrc(src: string, ctx: KbAssetContext): string {
  if (isExternalAssetSrc(src) || src.includes("/kb/repos/")) return src;
  return resolveKbAssetUrl(src, ctx);
}

export function editorizeKbMarkdown(markdown: string, ctx: KbAssetContext): string {
  return markdown
    .replace(IMAGE_MARKDOWN_RE, (full, alt: string, src: string) => {
      const resolved = editorizeSrc(src, ctx);
      return resolved === src ? full : `![${alt}](${resolved})`;
    })
    .replace(IMG_TAG_RE, (tag) => rewriteImgTagSrc(tag, (src) => editorizeSrc(src, ctx)));
}

export function persistKbMarkdown(markdown: string, ctx: KbAssetContext): string {
  return markdown
    .replace(IMAGE_MARKDOWN_RE, (full, alt: string, src: string) => {
      const relative = absolutizeKbAssetUrl(src, ctx);
      if (!relative) return full;
      return `![${alt}](${relative})`;
    })
    .replace(IMG_TAG_RE, (tag) => rewriteImgTagSrc(tag, (src) => absolutizeKbAssetUrl(src, ctx) ?? src));
}

export function kbImageMarkdown(alt: string, assetPath: string, ctx: KbAssetContext): string {
  const label = alt.replace(/[[\]]/g, "").trim() || "image";
  const previewUrl = resolveKbAssetUrl(assetPath, ctx);
  return `![${label}](${previewUrl})`;
}
