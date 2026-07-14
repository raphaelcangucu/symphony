/**
 * Triggers a browser download for a UTF-8 text file.
 */
export function downloadTextFile(content: string, filename: string): void {
  if (typeof document === "undefined") return;

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
