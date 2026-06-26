import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

export interface KbHeading {
  /** ProseMirror document position of the heading node. Unique within a snapshot. */
  pos: number;
  level: 1 | 2 | 3;
  text: string;
}

const TOC_LEVELS = new Set<number>([1, 2, 3]);
// Headings are derived from the `update` event, which fires per keystroke; this
// debounce keeps the outline from churning while the user types.
const RECOMPUTE_DELAY_MS = 200;

function collectHeadings(editor: Editor): KbHeading[] {
  const headings: KbHeading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return undefined;
    const level = Number(node.attrs.level);
    if (!TOC_LEVELS.has(level)) return false;
    headings.push({ pos, level: level as 1 | 2 | 3, text: node.textContent.trim() });
    // No need to descend into a heading's inline content.
    return false;
  });
  return headings;
}

function signatureOf(headings: KbHeading[]): string {
  return headings.map((heading) => `${heading.level}|${heading.pos}|${heading.text}`).join("\n");
}

/**
 * Derives the H1/H2 outline of the editor document and keeps it current as the
 * content changes. The returned array reference only changes when the outline
 * actually changes, so consumers (e.g. the table-of-contents observer) do not
 * re-run on every unrelated transaction.
 */
export function useKbHeadings(editor: Editor | null): KbHeading[] {
  const [headings, setHeadings] = useState<KbHeading[]>([]);
  const signatureRef = useRef<string>("");

  useEffect(() => {
    if (!editor) {
      signatureRef.current = "";
      setHeadings([]);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const recompute = () => {
      const next = collectHeadings(editor);
      const nextSignature = signatureOf(next);
      if (nextSignature === signatureRef.current) return;
      signatureRef.current = nextSignature;
      setHeadings(next);
    };

    recompute();

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(recompute, RECOMPUTE_DELAY_MS);
    };

    editor.on("update", schedule);
    return () => {
      editor.off("update", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);

  return headings;
}
