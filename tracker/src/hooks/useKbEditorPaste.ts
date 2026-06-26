import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { i18n } from "@/i18n";
import { extractImageFilesFromClipboard } from "@/lib/clipboardImages";
import { filterImageFiles } from "@/lib/imageFiles";
import {
  type KbAssetContext,
  kbImageMarkdown,
  resolveKbAssetUrl,
  suggestAssetName,
} from "@/lib/kbAssets";
import { pickImageFile } from "@/lib/pickImageFile";
import { uploadAsset } from "@/services/knowledgeBase";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const GENERIC_PASTE_NAMES = new Set(["image", "pasted", "screenshot", "untitled"]);

interface UseKbEditorPasteOptions {
  editor: Editor | null;
  assetContext: KbAssetContext | null;
  handlersRef: React.MutableRefObject<KbEditorPasteHandlers>;
}

export interface KbEditorPasteHandlers {
  handlePaste: (view: unknown, event: ClipboardEvent) => boolean;
  handleDrop: (view: unknown, event: DragEvent, slice: unknown, moved: boolean) => boolean;
}

export interface KbPendingPasteImage {
  id: string;
  previewUrl: string;
  suggestedName: string;
}

interface UseKbEditorPasteResult {
  uploading: boolean;
  pending: KbPendingPasteImage | null;
  confirmPending: (name: string) => void;
  cancelPending: () => void;
  onContainerDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onContainerDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  /** Opens a file picker and inserts the uploaded image at `insertPos` (or the selection). */
  pickAndInsertImage: (insertPos?: number) => void;
  /** Opens a file picker and swaps the image node at `pos` with the uploaded asset. */
  replaceImage: (pos: number) => void;
}

interface QueuedImage extends KbPendingPasteImage {
  file: File;
}

function sanitizeAlt(name: string): string {
  return name.replace(/[[\]]/g, "").trim() || "image";
}

function fileBaseName(name: string): string {
  const file = name.split(/[/\\]/).pop() ?? name;
  const dot = file.lastIndexOf(".");
  return (dot > 0 ? file.slice(0, dot) : file).trim();
}

function pasteSuggestion(file: File, pagePath: string | null): string {
  const base = fileBaseName(file.name ?? "");
  if (base.length > 0 && !GENERIC_PASTE_NAMES.has(base.toLowerCase())) return base;
  return suggestAssetName(pagePath);
}

function validateKbImageFile(file: File): void {
  if (file.size === 0) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.emptyFile"));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.imageTooLarge"));
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.imagesOnly"));
  }
}

function extractImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files ?? []);
  const itemTypes = files.map((file) => file.type);
  return filterImageFiles(files, itemTypes);
}

// During `dragover`/`dragenter` the browser hides file contents for security,
// so `dataTransfer.files` is always empty and only `types` is reliable. The
// container MUST `preventDefault` on dragover (based on `types`) or the browser
// refuses the drop entirely and the `drop` event never fires.
function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes("Files");
}

function nextId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `paste-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useKbEditorPaste({
  editor,
  assetContext,
  handlersRef,
}: UseKbEditorPasteOptions): UseKbEditorPasteResult {
  const [uploading, setUploading] = useState(false);
  const [queue, setQueue] = useState<QueuedImage[]>([]);
  const editorRef = useRef(editor);
  const assetContextRef = useRef(assetContext);
  editorRef.current = editor;
  assetContextRef.current = assetContext;

  const insertUploaded = useCallback(async (file: File, name?: string, insertPos?: number) => {
    const ctx = assetContextRef.current;
    const activeEditor = editorRef.current;
    if (!ctx || !activeEditor) {
      toast.error(i18n.t("kb.editor.paste.unavailable"));
      return;
    }

    setUploading(true);
    try {
      validateKbImageFile(file);
      const uploaded = await uploadAsset(ctx.projectSlug, ctx.repoSlug, file, ctx.pagePath, name);
      const alt = sanitizeAlt(name ?? file.name);
      const markdown = kbImageMarkdown(alt, uploaded.assetPath, ctx);
      const chain = activeEditor.chain().focus();
      if (typeof insertPos === "number") {
        const clamped = Math.min(Math.max(insertPos, 0), activeEditor.state.doc.content.size);
        chain.setTextSelection(clamped);
      }
      chain.insertContent(markdown).run();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : i18n.t("kb.editor.paste.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }, []);

  // Uploads a new asset and swaps the `src`/`alt` of the image node at `pos`,
  // preserving any alignment/width attributes the user already applied.
  const replaceUploaded = useCallback(async (pos: number, file: File, name?: string) => {
    const ctx = assetContextRef.current;
    const activeEditor = editorRef.current;
    if (!ctx || !activeEditor) {
      toast.error(i18n.t("kb.editor.paste.unavailable"));
      return;
    }

    setUploading(true);
    try {
      validateKbImageFile(file);
      const uploaded = await uploadAsset(ctx.projectSlug, ctx.repoSlug, file, ctx.pagePath, name);
      const src = resolveKbAssetUrl(uploaded.assetPath, ctx);
      const alt = sanitizeAlt(name ?? file.name);
      activeEditor
        .chain()
        .focus()
        .command(({ tr }) => {
          const target = tr.doc.nodeAt(pos);
          if (!target || target.type.name !== "image") return false;
          tr.setNodeMarkup(pos, undefined, { ...target.attrs, src, alt });
          return true;
        })
        .run();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : i18n.t("kb.editor.paste.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }, []);

  const pickAndInsertImage = useCallback(
    (insertPos?: number) => {
      if (!assetContextRef.current || !editorRef.current) {
        toast.error(i18n.t("kb.editor.paste.unavailable"));
        return;
      }
      void (async () => {
        const file = await pickImageFile();
        if (!file) return;
        await insertUploaded(file, fileBaseName(file.name) || undefined, insertPos);
      })();
    },
    [insertUploaded],
  );

  const replaceImage = useCallback(
    (pos: number) => {
      if (!assetContextRef.current || !editorRef.current) {
        toast.error(i18n.t("kb.editor.paste.unavailable"));
        return;
      }
      void (async () => {
        const file = await pickImageFile();
        if (!file) return;
        await replaceUploaded(pos, file, fileBaseName(file.name) || undefined);
      })();
    },
    [replaceUploaded],
  );

  // Dropped files keep their original name; nothing to confirm.
  const uploadPreservingNames = useCallback(
    async (files: File[]) => {
      if (!assetContextRef.current || !editorRef.current || files.length === 0) {
        toast.error(i18n.t("kb.editor.paste.unavailable"));
        return;
      }
      for (const file of files) {
        await insertUploaded(file, fileBaseName(file.name) || undefined);
      }
    },
    [insertUploaded],
  );

  // Pasted images are queued so the user can confirm or edit a friendly name.
  const enqueuePasted = useCallback((files: File[]) => {
    const pagePath = assetContextRef.current?.pagePath ?? null;
    const items = files.map<QueuedImage>((file) => ({
      id: nextId(),
      file,
      previewUrl: URL.createObjectURL(file),
      suggestedName: pasteSuggestion(file, pagePath),
    }));
    setQueue((prev) => [...prev, ...items]);
  }, []);

  const dequeueHead = useCallback(() => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (head) URL.revokeObjectURL(head.previewUrl);
      return rest;
    });
  }, []);

  const confirmPending = useCallback(
    (name: string) => {
      const head = queue[0];
      if (!head) return;
      dequeueHead();
      void insertUploaded(head.file, name.trim() || head.suggestedName);
    },
    [queue, dequeueHead, insertUploaded],
  );

  const cancelPending = useCallback(() => {
    dequeueHead();
  }, [dequeueHead]);

  handlersRef.current.handlePaste = (_view, event) => {
    const images = extractImageFilesFromClipboard(event);
    if (images.length === 0) return false;
    event.preventDefault();
    enqueuePasted(images);
    return true;
  };

  handlersRef.current.handleDrop = (_view, event, _slice, moved) => {
    if (moved) return false;
    const images = extractImageFilesFromDataTransfer(event.dataTransfer);
    if (images.length === 0) return false;
    event.preventDefault();
    void uploadPreservingNames(images);
    return true;
  };

  const onContainerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onContainerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // A drop over the editor text is handled by ProseMirror's `handleDrop`
      // (which calls preventDefault). Skip here to avoid a duplicate upload;
      // only handle drops that land on the surrounding padding.
      if (event.defaultPrevented) return;
      const images = extractImageFilesFromDataTransfer(event.dataTransfer);
      if (images.length === 0) return;
      event.preventDefault();
      editorRef.current?.commands.focus();
      void uploadPreservingNames(images);
    },
    [uploadPreservingNames],
  );

  useEffect(() => {
    return () => {
      setQueue((prev) => {
        prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return [];
      });
    };
  }, []);

  const head = queue[0] ?? null;
  const pending: KbPendingPasteImage | null = head
    ? { id: head.id, previewUrl: head.previewUrl, suggestedName: head.suggestedName }
    : null;

  return {
    uploading,
    pending,
    confirmPending,
    cancelPending,
    onContainerDragOver,
    onContainerDrop,
    pickAndInsertImage,
    replaceImage,
  };
}
