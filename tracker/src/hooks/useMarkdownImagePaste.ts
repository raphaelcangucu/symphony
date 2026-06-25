import { type ClipboardEvent, type Dispatch, type SetStateAction, useCallback, useState } from "react";
import { toast } from "sonner";

import { validateImageFile } from "@/components/assistant/assistantAttachments";
import { i18n } from "@/i18n";
import { extractImageFilesFromClipboard } from "@/lib/clipboardImages";
import { uploadAssistantAttachment } from "@/services/assistant";
import { projectAttachmentUrl } from "@/services/attachments";

interface UseMarkdownImagePasteOptions {
  projectSlug: string;
  setValue: Dispatch<SetStateAction<string>>;
}

interface UseMarkdownImagePasteResult {
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  uploading: boolean;
}

function sanitizeAlt(name: string): string {
  return name.replace(/[[\]]/g, "").trim() || "image";
}

function appendImageMarkdown(current: string, markdown: string): string {
  if (current.length === 0) return markdown;
  const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${markdown}`;
}

/**
 * Uploads pasted images to the project attachment store and appends a Markdown
 * image reference into the bound textarea value. Shared by the comment composer
 * and the issue description editor.
 */
export function useMarkdownImagePaste({
  projectSlug,
  setValue,
}: UseMarkdownImagePasteOptions): UseMarkdownImagePasteResult {
  const [uploading, setUploading] = useState(false);

  const uploadAndAppend = useCallback(
    async (files: File[]) => {
      const slug = projectSlug.trim();
      if (!slug) {
        toast.error(i18n.t("issue.attachments.imageUnavailable"));
        return;
      }

      setUploading(true);
      try {
        for (const file of files) {
          try {
            validateImageFile(file);
            const uploaded = await uploadAssistantAttachment(slug, file);
            const url = projectAttachmentUrl(slug, uploaded.path);
            const markdown = `![${sanitizeAlt(uploaded.name || file.name)}](${url})`;
            setValue((current) => appendImageMarkdown(current, markdown));
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : i18n.t("issue.attachments.imageUploadFailed"));
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [projectSlug, setValue],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = extractImageFilesFromClipboard(event);
      if (images.length === 0) return;
      event.preventDefault();
      void uploadAndAppend(images);
    },
    [uploadAndAppend],
  );

  return { handlePaste, uploading };
}
