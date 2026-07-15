import { isVideoAttachmentSource, isVideoMediaType } from "@/services/attachments";
import { i18n } from "@/i18n";

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
      type: "file";
      name: string;
      mediaType: string;
      path: string;
      previewUrl?: string;
      sizeBytes?: number;
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
  type: "image" | "file" | "audio";
  name: string;
  media_type: string;
  path?: string;
  data?: string;
  transcript?: string;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export function validateImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.imagesOnly"));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.imageTooLarge"));
  }
}

export function validateAttachmentFile(file: File): void {
  if (file.size === 0) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.emptyFile"));
  }
  if (file.type.startsWith("image/")) {
    validateImageFile(file);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.fileTooLarge"));
  }
}

interface UploadedAttachmentLike {
  type?: "image" | "file";
  path: string;
  name: string;
  mediaType?: string;
  sizeBytes?: number;
}

export function createImageAttachmentPreview(file: File, uploaded: UploadedAttachmentLike): AssistantAttachment {
  return {
    id: cryptoRandomId(),
    type: "image",
    name: uploaded.name || file.name,
    mediaType: uploaded.mediaType || file.type,
    previewUrl: URL.createObjectURL(file),
    path: uploaded.path,
  };
}

export function createFileAttachment(file: File, uploaded: UploadedAttachmentLike): AssistantAttachment {
  const mediaType = uploaded.mediaType || file.type || "application/octet-stream";

  return {
    id: cryptoRandomId(),
    type: "file",
    name: uploaded.name || file.name,
    mediaType,
    path: uploaded.path,
    previewUrl:
      isVideoMediaType(mediaType) || isVideoAttachmentSource(file.name) ? URL.createObjectURL(file) : undefined,
    sizeBytes: uploaded.sizeBytes ?? (file.size > 0 ? file.size : undefined),
  };
}

export function createAttachmentPreview(file: File, uploaded: UploadedAttachmentLike): AssistantAttachment {
  return uploaded.type === "file" ? createFileAttachment(file, uploaded) : createImageAttachmentPreview(file, uploaded);
}

export async function blobToAudioAttachment(blob: Blob, durationMs?: number): Promise<AssistantAttachment> {
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new Error(i18n.t("assistant.composer.attachmentValidation.audioTooLarge"));
  }

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

    if (attachment.type === "file") {
      return {
        type: "file",
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
      continue;
    }

    if (attachment.type === "file" && attachment.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(i18n.t("assistant.composer.attachmentValidation.readAudioFailed")));
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
