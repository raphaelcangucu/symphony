const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

export function isImageFileName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isImageMimeType(type: string | null | undefined): boolean {
  return typeof type === "string" && type.startsWith("image/");
}

/**
 * Screenshots and Explorer drops often arrive with an empty `File.type`.
 * Fall back to the clipboard item MIME type or the file name extension.
 */
export function isImageFile(file: File, itemType = ""): boolean {
  if (isImageMimeType(file.type)) return true;
  if (isImageMimeType(itemType)) return true;
  if (file.name && isImageFileName(file.name)) return true;
  // Pasted screenshots frequently have no name and no type.
  if (!file.type && !file.name && isImageMimeType(itemType)) return true;
  return false;
}

export function inferImageMimeType(file: File, itemType = ""): string {
  if (isImageMimeType(file.type)) return file.type;
  if (isImageMimeType(itemType)) return itemType;

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";

  return "image/png";
}

export function normalizeImageFile(file: File, itemType = ""): File {
  const type = inferImageMimeType(file, itemType);
  const ext = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "png");
  const name = file.name && file.name.trim().length > 0 ? file.name : `pasted.${ext}`;
  if (file.type === type && file.name === name) return file;
  return new File([file], name, { type, lastModified: file.lastModified });
}

export function filterImageFiles(files: File[], itemTypes: string[] = []): File[] {
  return files
    .map((file, index) => ({ file, itemType: itemTypes[index] ?? "" }))
    .filter(({ file, itemType }) => isImageFile(file, itemType))
    .map(({ file, itemType }) => normalizeImageFile(file, itemType));
}
