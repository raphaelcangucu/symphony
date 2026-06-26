import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it } from "vitest";
import { KbSpacerParagraph } from "@/components/kb/KbSpacerParagraph";
import { KbImage } from "@/components/kb/KbImageExtension";

function buildEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      KbSpacerParagraph,
      KbImage.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, linkify: false, breaks: false }),
    ],
    content,
  });
}

function selectEnd(ed: Editor): void {
  ed.commands.setTextSelection(ed.state.doc.content.size - 1);
}

// Mirrors the content-load path in KbEditor: replace the document without
// emitting an update and without recording the load in the undo history, so the
// first Ctrl+Z reverts the user's first edit instead of unwinding the load.
function loadContent(ed: Editor, content: string): void {
  ed.chain().setContent(content, { emitUpdate: false }).setMeta("addToHistory", false).run();
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("KbEditor undo/redo", () => {
  it("registers the undoRedo extension from StarterKit", () => {
    editor = buildEditor("<p>Hello</p>");
    const names = editor.extensionManager.extensions.map((ext) => ext.name);
    expect(names).toContain("undoRedo");
  });

  it("undoes a typed edit back to the loaded content", () => {
    editor = buildEditor("<p>Hello</p>");
    expect(editor.getText()).toBe("Hello");

    selectEnd(editor);
    editor.commands.insertContent("World");
    expect(editor.getText()).toContain("World");
    expect(editor.can().undo()).toBe(true);

    editor.commands.undo();
    expect(editor.getText()).toBe("Hello");
  });

  it("redoes an undone edit", () => {
    editor = buildEditor("<p>Hello</p>");
    selectEnd(editor);
    editor.commands.insertContent("World");
    const edited = editor.getText();

    editor.commands.undo();
    expect(editor.getText()).toBe("Hello");

    expect(editor.can().redo()).toBe(true);
    editor.commands.redo();
    expect(editor.getText()).toBe(edited);
  });

  it("does not let undo erase the freshly loaded document", () => {
    // Simulates the content-load effect: setContent without emitting an update,
    // followed by a user edit. Undo must stop at the loaded content rather than
    // unwinding the load transaction and blanking the page.
    editor = buildEditor("<p>placeholder</p>");
    loadContent(editor, "<p>Loaded paragraph</p>");
    expect(editor.getText()).toBe("Loaded paragraph");

    selectEnd(editor);
    editor.commands.insertContent("EDIT");
    expect(editor.getText()).toContain("EDIT");

    editor.commands.undo();
    expect(editor.getText()).toBe("Loaded paragraph");

    // A second undo must not wipe the loaded document.
    editor.commands.undo();
    expect(editor.getText()).toContain("Loaded paragraph");
  });
});
