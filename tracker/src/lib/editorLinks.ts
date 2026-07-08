import type { EditorReason } from "@/services/editor";

/**
 * Opens a desktop protocol URL (e.g. cursor://) via a temporary anchor, which
 * avoids the popup blocker heuristics that window.open can trigger.
 */
export function openDesktopProtocolUrl(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function editorUnavailableTitle(
  reason: EditorReason | null,
  loading: boolean,
  t: (key: string) => string,
): string {
  if (loading) return t("issue.drawer.editor.checking");
  switch (reason) {
    case "starting":
      return t("issue.drawer.editor.starting");
    case "workspace_missing":
      return t("issue.drawer.editor.workspaceMissing");
    case "workspace_skills_unavailable":
      return t("issue.drawer.editor.workspacePreparing");
    case "unavailable":
      return t("issue.drawer.editor.unavailableUpgrade");
    default:
      return t("issue.drawer.editor.unavailable");
  }
}
