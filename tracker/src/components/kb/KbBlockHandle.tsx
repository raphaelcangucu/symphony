import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import type { ChainedCommands } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { offset } from "@floating-ui/dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Code2,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Plus,
  Quote,
  Table as TableIcon,
  Trash2,
  Type,
} from "lucide-react";

type Menu = null | "insert" | "actions";

interface BlockTarget {
  node: ProseMirrorNode | null;
  pos: number;
}

interface InsertItem {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  /** Transforms a freshly inserted empty paragraph (heading, list, …). */
  transform?: (chain: ChainedCommands) => ChainedCommands;
  /** Inserts a self-contained node at the end of the block (table, divider). */
  insertAtEnd?: (chain: ChainedCommands) => ChainedCommands;
  /** Delegates insertion to an async picker (image upload) at the block end. */
  pick?: boolean;
}

const INSERT_ITEMS: InsertItem[] = [
  { id: "text", labelKey: "kb.editor.insert.text", icon: Type },
  { id: "h1", labelKey: "kb.editor.insert.h1", icon: Heading1, transform: (c) => c.toggleHeading({ level: 1 }) },
  { id: "h2", labelKey: "kb.editor.insert.h2", icon: Heading2, transform: (c) => c.toggleHeading({ level: 2 }) },
  { id: "h3", labelKey: "kb.editor.insert.h3", icon: Heading3, transform: (c) => c.toggleHeading({ level: 3 }) },
  { id: "bulletList", labelKey: "kb.editor.insert.bulletList", icon: List, transform: (c) => c.toggleBulletList() },
  { id: "orderedList", labelKey: "kb.editor.insert.orderedList", icon: ListOrdered, transform: (c) => c.toggleOrderedList() },
  { id: "quote", labelKey: "kb.editor.insert.quote", icon: Quote, transform: (c) => c.toggleBlockquote() },
  { id: "codeBlock", labelKey: "kb.editor.insert.codeBlock", icon: Code2, transform: (c) => c.toggleCodeBlock() },
  { id: "image", labelKey: "kb.editor.insert.image", icon: ImageIcon, pick: true },
  {
    id: "table",
    labelKey: "kb.editor.insert.table",
    icon: TableIcon,
    insertAtEnd: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  { id: "divider", labelKey: "kb.editor.insert.divider", icon: Minus, insertAtEnd: (c) => c.setHorizontalRule() },
];

const HANDLE_POSITION_CONFIG = {
  placement: "left-start" as const,
  strategy: "absolute" as const,
  // Keep the handle's right edge flush against the block so there is no dead
  // gap to cross (the plugin hides the handle on mouseleave). The visual gap to
  // the text comes from the handle's own right padding, which stays hoverable.
  middleware: [offset({ mainAxis: 0, crossAxis: 4 })],
};

interface KbBlockHandleProps {
  editor: Editor;
  /** Opens the image picker and inserts the upload at the given document position. */
  onInsertImage?: (insertPos: number) => void;
}

export function KbBlockHandle({ editor, onInsertImage }: KbBlockHandleProps) {
  const { t } = useTranslation();
  const targetRef = useRef<BlockTarget>({ node: null, pos: 0 });
  const [menu, setMenu] = useState<Menu>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, close]);

  const insertBlock = useCallback(
    (item: InsertItem) => {
      const { node, pos } = targetRef.current;
      if (!node) return;
      const end = pos + node.nodeSize;

      if (item.pick) {
        onInsertImage?.(end);
        close();
        return;
      }

      if (item.insertAtEnd) {
        item.insertAtEnd(editor.chain().focus().setTextSelection(end).insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1)).run();
        close();
        return;
      }

      editor.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run();
      if (item.transform) item.transform(editor.chain().focus()).run();
      close();
    },
    [editor, close, onInsertImage],
  );

  const deleteBlock = useCallback(() => {
    const { node, pos } = targetRef.current;
    if (!node) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    close();
  }, [editor, close]);

  const duplicateBlock = useCallback(() => {
    const { node, pos } = targetRef.current;
    if (!node) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
    close();
  }, [editor, close]);

  const toggleMenu = (next: Menu) => setMenu((current) => (current === next ? null : next));

  // Must be referentially stable: TipTap's DragHandle re-registers its
  // ProseMirror plugin whenever onNodeChange changes identity, and
  // registerPlugin updates the editor → parent re-render → new inline
  // callback → infinite update loop (React #185) after opening a menu.
  const onNodeChange = useCallback(({ node, pos }: BlockTarget) => {
    targetRef.current = { node, pos };
    setMenu(null);
  }, []);

  return (
    <DragHandle
      editor={editor}
      computePositionConfig={HANDLE_POSITION_CONFIG}
      onNodeChange={onNodeChange}
    >
      <div ref={rootRef} className="kb-block-handle relative flex items-center gap-1 pr-2.5">
        <button
          type="button"
          aria-label={t("kb.editor.block.add")}
          title={t("kb.editor.block.add")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => toggleMenu("insert")}
          className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("kb.editor.block.actions")}
          title={t("kb.editor.block.actions")}
          onClick={() => toggleMenu("actions")}
          className="flex h-6 w-4 cursor-grab items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {menu === "insert" && (
          <div className="absolute left-0 top-7 z-50 max-h-72 w-52 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
            {INSERT_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertBlock(item)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-accent"
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        )}

        {menu === "actions" && (
          <div className="absolute left-0 top-7 z-50 w-44 rounded-lg border bg-popover p-1 shadow-md">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={duplicateBlock}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-accent"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
              {t("kb.editor.block.duplicate")}
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={deleteBlock}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              {t("kb.editor.block.delete")}
            </button>
          </div>
        )}
      </div>
    </DragHandle>
  );
}
