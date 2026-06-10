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

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }

  if (files.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Extracts image files from a paste event. Handles both pasted screenshots
 * (delivered as clipboard items) and copied image files.
 */
export function extractImageFilesFromClipboard(event: ClipboardEventLike): File[] {
  return extractFilesFromClipboard(event).filter((file) => file.type.startsWith("image/"));
}
