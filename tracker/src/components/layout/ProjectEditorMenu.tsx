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
import { useProjectEditor } from "@/hooks/useProjectEditor";
import { editorUnavailableTitle, openDesktopProtocolUrl } from "@/lib/editorLinks";

interface ProjectEditorMenuProps {
  projectSlug: string;
}

export function ProjectEditorMenu({ projectSlug }: ProjectEditorMenuProps) {
  const { t } = useTranslation();
  const editor = useProjectEditor({ projectSlug });

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
    ? t("layout.projectHeader.openProjectWorkspaceCode")
    : editorUnavailableTitle(editor.browser.reason ?? editor.cursorDesktop.reason, editor.loading, t);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!anyEditorAvailable && !editor.loading}
          title={editorMenuTitle}
          aria-label={t("layout.projectHeader.openProjectWorkspaceCode")}
        >
          <Code2 className="h-4 w-4" />
          <span className="hidden sm:inline">{t("issue.drawer.code")}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
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

