import Image, { type ImageOptions } from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Captions,
  Check,
  RefreshCw,
  Scaling,
  Trash2,
} from "lucide-react";

import { fetchAttachmentObjectUrl, isTrackerAuthenticatedMediaUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";

type Alignment = "left" | "center" | "right";
const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right"];

interface SizePreset {
  id: string;
  labelKey: string;
  width: string | null;
}

const SIZE_PRESETS: readonly SizePreset[] = [
  { id: "small", labelKey: "kb.editor.image.sizeSmall", width: "33%" },
  { id: "medium", labelKey: "kb.editor.image.sizeMedium", width: "66%" },
  { id: "full", labelKey: "kb.editor.image.sizeFull", width: null },
];

/** Minimal slice of the prosemirror-markdown serializer used by tiptap-markdown. */
interface MarkdownSerializerState {
  write: (text: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
}

export interface KbImageOptions {
  /** Invoked by the node view to upload a new file and swap this image's src. */
  onRequestReplace: ((pos: number) => void) | null;
}

function attrString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/[[\]]/g, "").trim();
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Plain images stay portable Markdown (`![alt](src)`). Only images carrying an
// explicit alignment or width — which Markdown cannot express — are serialized
// as a single self-closing HTML tag (valid because the editor enables `html`).
function serializeKbImage(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  const src = attrString(node.attrs.src);
  const alt = attrString(node.attrs.alt);
  const width = attrString(node.attrs.width);
  const align = attrString(node.attrs.align);

  if (!width && !align) {
    state.write(`![${escapeMarkdownAlt(alt)}](${src})`);
    state.closeBlock(node);
    return;
  }

  const attrs = [`src="${escapeHtmlAttr(src)}"`];
  if (alt) attrs.push(`alt="${escapeHtmlAttr(alt)}"`);
  if (width) attrs.push(`style="width: ${escapeHtmlAttr(width)}"`);
  if (align) attrs.push(`data-align="${escapeHtmlAttr(align)}"`);
  state.write(`<img ${attrs.join(" ")} />`);
  state.closeBlock(node);
}

function ToolbarButton({
  label,
  active,
  destructive,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;
}

function KbImageView({ node, extension, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const src = attrString(node.attrs.src);
  const alt = attrString(node.attrs.alt);
  const width = node.attrs.width === null ? null : attrString(node.attrs.width) || null;
  const align = (ALIGNMENTS.includes(node.attrs.align as Alignment) ? node.attrs.align : null) as Alignment | null;

  const [displaySrc, setDisplaySrc] = useState(src);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [altDraft, setAltDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!src || !isTrackerAuthenticatedMediaUrl(src)) {
      setDisplaySrc(src);
      return;
    }

    let cancelled = false;
    void fetchAttachmentObjectUrl(src)
      .then((url) => {
        if (!cancelled) setDisplaySrc(url);
      })
      .catch(() => {
        if (!cancelled) setDisplaySrc(src);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;

  const requestReplace = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const options = extension.options as KbImageOptions;
    options.onRequestReplace?.(pos);
  };

  const toggleAlign = (next: Alignment) => updateAttributes({ align: align === next ? null : next });
  const applyWidth = (next: string | null) => {
    updateAttributes({ width: next });
    setSizeMenuOpen(false);
  };

  const editingAlt = altDraft !== null;
  const commitAlt = () => {
    if (altDraft === null) return;
    updateAttributes({ alt: escapeMarkdownAlt(altDraft) });
    setAltDraft(null);
  };

  return (
    <NodeViewWrapper
      as="figure"
      data-align={align ?? undefined}
      style={{ width: width ?? undefined }}
      className={cn("kb-image group relative", align && `is-${align}`, selected && "ProseMirror-selectednode")}
    >
      <img src={displaySrc} alt={alt} draggable={false} style={width ? { width: "100%" } : undefined} />

      <div
        contentEditable={false}
        className={cn(
          "kb-image-toolbar absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-1 opacity-0 shadow-md backdrop-blur transition group-hover:opacity-100",
          (selected || sizeMenuOpen || editingAlt) && "opacity-100",
        )}
      >
        <ToolbarButton label={t("kb.editor.image.replace")} onClick={requestReplace}>
          <RefreshCw className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t("kb.editor.image.editAlt")}
          active={editingAlt}
          onClick={() => setAltDraft(alt)}
        >
          <Captions className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton label={t("kb.editor.image.alignLeft")} active={align === "left"} onClick={() => toggleAlign("left")}>
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t("kb.editor.image.alignCenter")}
          active={align === "center"}
          onClick={() => toggleAlign("center")}
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label={t("kb.editor.image.alignRight")} active={align === "right"} onClick={() => toggleAlign("right")}>
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <div className="relative">
          <ToolbarButton label={t("kb.editor.image.size")} active={sizeMenuOpen} onClick={() => setSizeMenuOpen((open) => !open)}>
            <Scaling className="h-4 w-4" />
          </ToolbarButton>
          {sizeMenuOpen && (
            <div className="absolute right-0 top-9 z-50 w-36 rounded-lg border bg-popover p-1 shadow-md">
              {SIZE_PRESETS.map((preset) => {
                const isActive = (preset.width ?? null) === width;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyWidth(preset.width)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t(preset.labelKey)}
                    {isActive && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ToolbarDivider />

        <ToolbarButton label={t("kb.editor.image.delete")} destructive onClick={() => deleteNode()}>
          <Trash2 className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {editingAlt && (
        <div contentEditable={false} className="mt-2">
          <input
            autoFocus
            value={altDraft ?? ""}
            placeholder={t("kb.editor.image.altPlaceholder")}
            onChange={(event) => setAltDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitAlt();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setAltDraft(null);
              }
            }}
            onBlur={commitAlt}
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const KbImage = Image.extend<ImageOptions & KbImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      onRequestReplace: null,
    } as ImageOptions & KbImageOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const style = element.style?.width?.trim();
          if (style) return style;
          const attr = element.getAttribute("width")?.trim();
          return attr && attr.length > 0 ? attr : null;
        },
        renderHTML: (attributes) => {
          const width = attributes.width;
          return typeof width === "string" && width.length > 0 ? { style: `width: ${width}` } : {};
        },
      },
      align: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-align");
          return value && ALIGNMENTS.includes(value as Alignment) ? value : null;
        },
        renderHTML: (attributes) => {
          const align = attributes.align;
          return typeof align === "string" && align.length > 0 ? { "data-align": align } : {};
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeKbImage,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(KbImageView);
  },
});
