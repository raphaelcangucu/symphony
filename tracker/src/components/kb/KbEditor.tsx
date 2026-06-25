import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const AUTO_SAVE_DELAY_MS = 1500;

interface Props {
  title: string;
  markdown: string;
  saving: boolean;
  onSave: (markdown: string) => Promise<void> | void;
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

export function KbEditor({ title, markdown, saving, onSave }: Props) {
  const { t } = useTranslation();
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: markdown,
  });

  const handleSave = useCallback(async () => {
    if (!editor) return;
    await onSave(readMarkdown(editor));
  }, [editor, onSave]);

  useEffect(() => {
    if (!editor) return;
    if (markdown !== readMarkdown(editor)) {
      editor.commands.setContent(markdown, { emitUpdate: false });
    }
  }, [markdown, editor]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => void handleSave(), AUTO_SAVE_DELAY_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [editor, handleSave]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 data-testid="kb-editor-title" className="truncate text-lg font-semibold">
          {title}
        </h1>
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t("kb.editor.saving") : t("kb.editor.save")}
        </Button>
      </header>
      <div className="prose prose-sm dark:prose-invert max-w-none flex-1 overflow-y-auto p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
