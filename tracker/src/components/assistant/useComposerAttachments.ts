import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  type AssistantAttachment,
  createAttachmentPreview,
  revokeAttachmentPreviews,
  validateAttachmentFile,
} from "@/components/assistant/assistantAttachments";
import { extractFilesFromClipboard } from "@/lib/clipboardImages";
import { uploadAssistantAttachment } from "@/services/assistant";

function eventHasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

interface UseComposerAttachmentsOptions {
  projectSlug: string;
  /**
   * Optional element that acts as the file drop zone. When provided, dropping
   * files anywhere inside it (e.g. the whole assistant panel) attaches them,
   * instead of only the composer form.
   */
  dropTargetRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Owns the composer's attachment lifecycle: uploads (picker/paste/drag-drop),
 * previews, and the drag-active overlay state. When `dropTargetRef` is set,
 * native listeners on that element replace the form's own drag handlers.
 */
export function useComposerAttachments({ projectSlug, dropTargetRef }: UseComposerAttachmentsOptions) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [nativeDropZoneActive, setNativeDropZoneActive] = useState(false);
  const dragDepthRef = useRef(0);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    if (!projectSlug.trim()) {
      toast.error(t("assistant.composer.attachmentsUnavailable"));
      return;
    }

    for (const file of files) {
      try {
        validateAttachmentFile(file);
        setUploadingImage(true);
        const uploaded = await uploadAssistantAttachment(projectSlug, file);
        const attachment = createAttachmentPreview(file, uploaded);
        setAttachments((current) => [...current, attachment]);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("assistant.composer.uploadFailed"));
      } finally {
        setUploadingImage(false);
      }
    }
  }

  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;

  // When a drop target element is provided (e.g. the whole assistant panel),
  // attach native drag-and-drop listeners to it so files can be dropped
  // anywhere inside the panel, not only on the composer form.
  useEffect(() => {
    const el = dropTargetRef?.current ?? null;
    if (!el) {
      setNativeDropZoneActive(false);
      return;
    }

    setNativeDropZoneActive(true);

    const hasFiles = (event: globalThis.DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      void uploadFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };

    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);

    return () => {
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [dropTargetRef]);

  async function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadFiles(files);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = extractFilesFromClipboard(event);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void uploadFiles(files);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target) revokeAttachmentPreviews([target]);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function clearAttachments() {
    setAttachments((current) => {
      revokeAttachmentPreviews(current);
      return [];
    });
  }

  const replaceAttachments = useCallback((next: AssistantAttachment[]) => {
    if (!Array.isArray(next)) {
      throw new Error("replaceAttachments requires an attachments array");
    }
    setAttachments((current) => {
      revokeAttachmentPreviews(current);
      return next;
    });
  }, []);

  return {
    attachments,
    uploadingImage,
    dragActive,
    nativeDropZoneActive,
    handleFilePick,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    clearAttachments,
    replaceAttachments,
  };
}
