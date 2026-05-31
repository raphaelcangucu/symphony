export type AssistantAttachment =
  | {
      id: string;
      type: "image";
      name: string;
      mediaType: string;
      previewUrl: string;
      path: string;
    }
  | {
      id: string;
      type: "audio";
      name: string;
      mediaType: string;
      dataUrl: string;
      durationMs?: number;
      transcript?: string;
    };

export interface AssistantOutgoingAttachment {
  type: "image" | "audio";
  name: string;
  media_type: string;
  path?: string;
  data?: string;
  transcript?: string;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export function validateImageFile(file: File): void {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are supported.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 4 MB or smaller.");
}

export function createImageAttachmentPreview(
  file: File,
  uploaded: { path: string; name: string; mediaType?: string; media_type?: string },
): AssistantAttachment {
  return {
    id: cryptoRandomId(),
    type: "image",
    name: uploaded.name || file.name,
    mediaType: uploaded.mediaType || uploaded.media_type || file.type,
    previewUrl: URL.createObjectURL(file),
    path: uploaded.path,
  };
}

export async function blobToAudioAttachment(blob: Blob, durationMs?: number): Promise<AssistantAttachment> {
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Audio recordings must be 8 MB or smaller.");

  const dataUrl = await readBlobAsDataUrl(blob);

  return {
    id: cryptoRandomId(),
    type: "audio",
    name: `recording-${new Date().toISOString()}.webm`,
    mediaType: blob.type || "audio/webm",
    dataUrl,
    durationMs,
  };
}

export function serializeAttachments(attachments: AssistantAttachment[]): AssistantOutgoingAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.type === "image") {
      return {
        type: "image",
        name: attachment.name,
        media_type: attachment.mediaType,
        path: attachment.path,
      };
    }

    const data = dataUrlToBase64(attachment.dataUrl);

    return {
      type: "audio",
      name: attachment.name,
      media_type: attachment.mediaType,
      data,
      transcript: attachment.transcript,
    };
  });
}

export function revokeAttachmentPreviews(attachments: AssistantAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.type === "image" && attachment.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read audio."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl;
  return dataUrl.slice(comma + 1);
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
