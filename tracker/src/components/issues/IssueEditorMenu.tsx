import { ChevronDown, Code2 } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIssueEditor } from "@/hooks/useIssueEditor";
import type { EditorReason } from "@/services/editor";

interface IssueEditorMenuProps {
  projectSlug: string;
  identifier: string;
  enabled?: boolean;
  /** Tighter trigger for dense toolbars (session header row). */
  compact?: boolean;
}

export function IssueEditorMenu({ projectSlug, identifier, enabled = true, compact = false }: IssueEditorMenuProps) {
  const { t } = useTranslation();
  const editor = useIssueEditor({ projectSlug, identifier, enabled });

  const openBrowserEditor = useCallback(() => {
    if (editor.browser.available && editor.browser.url) {
      window.open(editor.browser.url, "_blank", "noopener");
    }
  }, [editor.browser.available, editor.browser.url]);

  const openCursorDesktop = useCallback(() => {
    if (editor.cursorDesktop.available && editor.cursorDesktop.url) {
      openDesktopProtocolUrl(editor.cursorDesktop.url);
    }
  }, [editor.cursorDesktop.available, editor.cursorDesktop.url]);

  const anyEditorAvailable = editor.browser.available || editor.cursorDesktop.available;
  const editorMenuTitle = editor.browser.available
    ? t("issue.drawer.openWorkspaceCode")
    : editorUnavailableTitle(editor.browser.reason ?? editor.cursorDesktop.reason, editor.loading, t);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={compact ? "h-7 gap-1 px-2 text-xs" : undefined}
          disabled={!anyEditorAvailable && !editor.loading}
          title={editorMenuTitle}
          aria-label={t("issue.drawer.openInCode")}
        >
          <Code2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span className="hidden sm:inline">{t("issue.drawer.code")}</span>
          <ChevronDown className={compact ? "h-3.5 w-3.5 opacity-60" : "h-4 w-4 opacity-60"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          disabled={!editor.browser.available}
          title={
            editor.browser.available
              ? t("issue.drawer.openInCodeBrowser")
              : editorUnavailableTitle(editor.browser.reason, editor.loading, t)
          }
          onSelect={() => openBrowserEditor()}
        >
          <Code2 className="mr-2 h-4 w-4" />
          {t("issue.drawer.editor.vsCode")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!editor.cursorDesktop.available}
          title={
            editor.cursorDesktop.available
              ? t("issue.drawer.openInCursor")
              : editorUnavailableTitle(editor.cursorDesktop.reason, editor.loading, t)
          }
          onSelect={() => openCursorDesktop()}
        >
          <Code2 className="mr-2 h-4 w-4" />
          {t("issue.drawer.editor.cursor")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function openDesktopProtocolUrl(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function editorUnavailableTitle(
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
