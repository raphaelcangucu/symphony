import type { AssistantOutgoingAttachment } from "@/components/assistant/assistantAttachments";
import { projectAttachmentUrl } from "@/services/attachments";

const TEXT_FILE_INLINE_MAX = 512 * 1024;

function markdownAlt(name: string): string {
  return name.replace(/[\[\]]/g, "");
}

function fileLinkHint(name: string, url: string | null): string {
  if (!url) return "";
  return ` (saved in this project; link it in Markdown with the exact URL ${url})`;
}

function attachmentNote(
  attachment: AssistantOutgoingAttachment,
  projectSlug: string,
  fileText?: string,
): string {
  if (attachment.type === "image") {
    const url = attachment.path ? projectAttachmentUrl(projectSlug, attachment.path) : null;
    if (url) {
      return (
        `Attached image "${attachment.name}" (already saved in this project). ` +
        "To show it in an issue description, comment, or document, embed it with this exact Markdown " +
        `(keep the URL unchanged): ![${markdownAlt(attachment.name)}](${url})`
      );
    }
    return `Attached image: ${attachment.name}`;
  }

  if (attachment.type === "file") {
    const url = attachment.path ? projectAttachmentUrl(projectSlug, attachment.path) : null;
    const link = fileLinkHint(attachment.name, url);
    if (fileText && fileText.length > 0) {
      const truncated = fileText.length > TEXT_FILE_INLINE_MAX;
      const body = truncated ? fileText.slice(0, TEXT_FILE_INLINE_MAX) : fileText;
      const suffix = truncated ? "\n[... file truncated ...]" : "";
      return `Attached file \`${attachment.name}\`${link}:\n<<<BEGIN FILE ${attachment.name}>>>\n${body}${suffix}\n<<<END FILE ${attachment.name}>>>`;
    }
    return `Attached file: ${attachment.name} (binary)${link}.`;
  }

  if (attachment.type === "audio") {
    if (attachment.transcript?.trim()) {
      return `Audio note (${attachment.name}): ${attachment.transcript.trim()}`;
    }
    return `Audio attachment: ${attachment.name} (transcription unavailable).`;
  }

  return "";
}

/** Mirrors backend Payload.enrich_message for tracker guidance comments. */
export function enrichGuidanceWithAttachments(
  message: string,
  attachments: AssistantOutgoingAttachment[],
  projectSlug: string,
  fileTexts: Record<string, string> = {},
): string {
  const notes = attachments
    .map((attachment) =>
      attachmentNote(attachment, projectSlug, attachment.path ? fileTexts[attachment.path] : undefined),
    )
    .filter((note) => note.length > 0);

  const trimmed = message.trim();
  if (notes.length === 0) return trimmed;
  return [trimmed, ...notes].filter((part) => part.length > 0).join("\n\n");
}

export async function maybeReadInlineFileText(file: File): Promise<string | undefined> {
  const isTextLike =
    file.type.startsWith("text/") ||
    /\.(md|txt|json|ya?ml|toml|csv|tsx?|jsx?|py|ex|exs|rs|go|sh|sql|html|css|xml|ini|env|log)$/i.test(
      file.name,
    );

  if (!isTextLike || file.size === 0 || file.size > TEXT_FILE_INLINE_MAX) return undefined;

  try {
    return await file.text();
  } catch {
    return undefined;
  }
}
