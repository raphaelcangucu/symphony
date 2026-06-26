import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  Loader2,
  Sparkles,
  Strikethrough,
} from "lucide-react";

import { useKbEditorPaste, type KbEditorPasteHandlers } from "@/hooks/useKbEditorPaste";
import { type KbAssetContext, editorizeKbMarkdown, persistKbMarkdown } from "@/lib/kbAssets";
import { cn } from "@/lib/utils";
import { KbAssetNameDialog } from "./KbAssetNameDialog";
import { KbImage } from "./KbImageExtension";
import { KbSpacerParagraph } from "./KbSpacerParagraph";
import { KbBlockHandle } from "./KbBlockHandle";
import { KbPageActionsMenu } from "./KbPageActionsMenu";
import { KbSyncBadge } from "./KbSyncBadge";
import type { KbSyncState } from "@/types/knowledgeBase";

const AUTO_SAVE_DELAY_MS = 1500;

type SaveState = "clean" | "dirty" | "saving" | "saved";

export interface KbEditorLiveContext {
  body: string;
  selection: string;
}

interface Props {
  title: string;
  markdown: string;
  saving: boolean;
  favorite?: boolean;
  onSave: (markdown: string) => Promise<void> | void;
  onRename?: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
  assetContext?: KbAssetContext | null;
  syncState?: KbSyncState | null;
  syncLoading?: boolean;
  onSync?: () => void;
  assistantActive?: boolean;
  onToggleAssistant?: () => void;
  /**
   * Receives a getter for the live document snapshot (persisted body + current
   * selection). The getter is read lazily at message-send time so the assistant
   * always sees the latest content without re-rendering on every keystroke.
   */
  onRegisterContext?: (getter: () => KbEditorLiveContext) => void;
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function readSelectionText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return "";
  return editor.state.doc.textBetween(from, to, "\n", " ");
}

function MenuButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function KbEditor({
  title,
  markdown,
  saving,
  favorite = false,
  onSave,
  onRename,
  onToggleFavorite,
  onDelete,
  assetContext = null,
  syncState,
  syncLoading = false,
  onSync,
  assistantActive = false,
  onToggleAssistant,
  onRegisterContext,
}: Props) {
  const { t } = useTranslation();
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetContextRef = useRef<KbAssetContext | null>(assetContext);
  const onRegisterContextRef = useRef<Props["onRegisterContext"]>(onRegisterContext);
  onRegisterContextRef.current = onRegisterContext;
  // The normalized markdown of the currently loaded document. Auto-save only
  // fires when the serialized content actually diverges from this baseline, so
  // opening a page or an accidental keystroke that is reverted never writes.
  const baselineRef = useRef<string>("");
  // The last `markdown` prop we loaded into the editor. The content-load effect
  // only re-applies content when this changes, so re-renders for unrelated
  // reasons never reset the editor and discard in-progress edits.
  const lastLoadedMarkdownRef = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");

  assetContextRef.current = assetContext;

  const handlersRef = useRef<KbEditorPasteHandlers>({
    handlePaste: () => false,
    handleDrop: () => false,
  });
  // Stable indirection so the image node view can trigger an upload-backed
  // replace: the editor is created before the paste hook exists, so the
  // extension reads the latest `replaceImage` lazily through this ref.
  const replaceImageRef = useRef<(pos: number) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      KbSpacerParagraph,
      KbImage.configure({
        inline: false,
        allowBase64: false,
        onRequestReplace: (pos) => replaceImageRef.current(pos),
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? t("kb.editor.headingPlaceholder")
            : t("kb.editor.placeholder"),
        includeChildren: false,
      }),
      Markdown.configure({
        html: true,
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: markdown,
    editorProps: {
      attributes: { class: "kb-prose focus:outline-none" },
      handlePaste: (_view, event) => handlersRef.current.handlePaste(_view, event),
      handleDrop: (_view, event, slice, moved) =>
        handlersRef.current.handleDrop(_view, event, slice, moved),
    },
    onCreate: ({ editor: created }) => {
      baselineRef.current = readMarkdown(created);
    },
  });

  const {
    uploading,
    pending,
    confirmPending,
    cancelPending,
    onContainerDragOver,
    onContainerDrop,
    pickAndInsertImage,
    replaceImage,
  } = useKbEditorPaste({
    editor,
    assetContext,
    handlersRef,
  });

  useEffect(() => {
    replaceImageRef.current = replaceImage;
  }, [replaceImage]);

  const serializeForSave = useCallback(
    (editorInstance: Editor) => {
      const raw = readMarkdown(editorInstance);
      const ctx = assetContextRef.current;
      return ctx ? persistKbMarkdown(raw, ctx) : raw;
    },
    [],
  );

  const persist = useCallback(
    async (force: boolean) => {
      if (!editor) return;
      const next = serializeForSave(editor);
      if (!force && next === baselineRef.current) return;
      baselineRef.current = next;
      setSaveState("saving");
      await onSave(next);
      setSaveState("saved");
    },
    [editor, onSave, serializeForSave],
  );

  // Load incoming page content without emitting an update (so loading a page
  // never triggers auto-save) and reset the baseline to its normalized form.
  // Guard on the source `markdown` actually changing: re-running for unrelated
  // reasons (e.g. a new assetContext reference) must never reset the editor and
  // wipe edits the user has not navigated away from yet.
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastLoadedMarkdownRef.current) return;
    lastLoadedMarkdownRef.current = markdown;
    const ctx = assetContextRef.current;
    const displayMarkdown = ctx ? editorizeKbMarkdown(markdown, ctx) : markdown;
    if (displayMarkdown !== readMarkdown(editor)) {
      // `addToHistory: false` keeps the load out of the undo stack so the first
      // Ctrl+Z reverts the user's first edit instead of unwinding the load and
      // blanking (or reverting) the freshly opened document.
      editor
        .chain()
        .setContent(displayMarkdown, { emitUpdate: false })
        .setMeta("addToHistory", false)
        .run();
    }
    baselineRef.current = markdown;
    setSaveState("clean");
  }, [markdown, editor]);

  useEffect(() => {
    if (!editor) return;
    onRegisterContextRef.current?.(() => ({
      body: serializeForSave(editor),
      selection: readSelectionText(editor),
    }));
  }, [editor, serializeForSave]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      setSaveState((prev) => (prev === "saving" ? prev : "dirty"));
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => void persist(false), AUTO_SAVE_DELAY_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [editor, persist]);

  const status = useMemo(() => {
    if (uploading) {
      return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: t("kb.editor.paste.uploading") };
    }
    if (saving || saveState === "saving") {
      return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: t("kb.editor.saving") };
    }
    if (saveState === "dirty") {
      return { icon: null, label: t("kb.editor.unsaved") };
    }
    if (saveState === "saved") {
      return { icon: <Check className="h-3.5 w-3.5" />, label: t("kb.editor.saved") };
    }
    return null;
  }, [uploading, saving, saveState, t]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 px-6 py-2 md:px-12">
        <span
          data-testid="kb-editor-title"
          className="truncate text-xs font-medium text-muted-foreground"
        >
          {title}
        </span>
        <div className="flex items-center gap-3">
          {status && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {status.icon}
              {status.label}
            </span>
          )}
          {onSync ? <KbSyncBadge state={syncState ?? null} /> : null}
          {onToggleAssistant ? (
            <button
              type="button"
              onClick={onToggleAssistant}
              aria-label={assistantActive ? t("kb.editor.closeAssistant") : t("kb.editor.askAi")}
              aria-pressed={assistantActive}
              title={assistantActive ? t("kb.editor.closeAssistant") : t("kb.editor.askAi")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                assistantActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("kb.editor.askAi")}
            </button>
          ) : null}
          {onRename && onToggleFavorite && onDelete ? (
            <KbPageActionsMenu
              title={title}
              favorite={favorite}
              onRename={onRename}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
              onSync={onSync}
              syncing={syncLoading || syncState?.status === "syncing"}
            />
          ) : null}
          <button
            type="button"
            onClick={() => void persist(true)}
            disabled={saving || uploading}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t("kb.editor.save")}
          </button>
        </div>
      </header>

      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
        >
          <MenuButton
            label={t("kb.editor.format.bold")}
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </MenuButton>
          <MenuButton
            label={t("kb.editor.format.italic")}
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </MenuButton>
          <MenuButton
            label={t("kb.editor.format.strike")}
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </MenuButton>
          <MenuButton
            label={t("kb.editor.format.code")}
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" />
          </MenuButton>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <MenuButton
            label={t("kb.editor.insert.h1")}
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </MenuButton>
          <MenuButton
            label={t("kb.editor.insert.h2")}
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </MenuButton>
          <MenuButton
            label={t("kb.editor.insert.bulletList")}
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </MenuButton>
        </BubbleMenu>
      )}

      {editor && <KbBlockHandle editor={editor} onInsertImage={pickAndInsertImage} />}

      <div
        className="kb-editor flex-1 overflow-y-auto scrollbar-discrete"
        onDragOver={onContainerDragOver}
        onDrop={onContainerDrop}
      >
        <div className="mx-auto w-full max-w-3xl px-6 pb-32 pt-8 md:px-12">
          <EditorContent editor={editor} />
        </div>
      </div>

      {pending ? (
        <KbAssetNameDialog
          key={pending.id}
          previewUrl={pending.previewUrl}
          suggestedName={pending.suggestedName}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      ) : null}
    </div>
  );
}
