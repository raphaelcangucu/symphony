import { filterImageFiles } from "@/lib/imageFiles";

interface ClipboardEventLike {
  clipboardData: DataTransfer | null;
}

/**
 * Extracts any files from a paste event. Handles both pasted screenshots
 * (delivered as clipboard items) and copied files.
 */
export function extractFilesFromClipboard(event: ClipboardEventLike): File[] {
  const data = event.clipboardData;
  if (!data) return [];

  const files: File[] = [];
  const itemTypes: string[] = [];

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file);
    itemTypes.push(item.type);
  }

  if (files.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      files.push(file);
      itemTypes.push(file.type);
    }
  }

  return files;
}

/**
 * Extracts image files from a paste event. Handles pasted screenshots with an
 * empty `File.type`, copied image files, and clipboard items typed as image/*.
 */
export function extractImageFilesFromClipboard(event: ClipboardEventLike): File[] {
  const data = event.clipboardData;
  if (!data) return [];

  const files: File[] = [];
  const itemTypes: string[] = [];

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file);
    itemTypes.push(item.type);
  }

  if (files.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      files.push(file);
      itemTypes.push(file.type);
    }
  }

  return filterImageFiles(files, itemTypes);
}
