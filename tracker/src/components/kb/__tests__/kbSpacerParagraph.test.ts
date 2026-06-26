import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { KbSpacerParagraph } from "@/components/kb/KbSpacerParagraph";

const NBSP = "\u00A0";

function serialize(content: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      KbSpacerParagraph,
      Markdown.configure({ html: true, linkify: false, breaks: false }),
    ],
    content,
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const out = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();
  return out;
}

describe("KbSpacerParagraph markdown round-trip", () => {
  it("preserves an empty paragraph between two blocks as a blank spacer line", () => {
    const out = serialize("<p>A</p><p></p><p>B</p>");
    expect(out).toBe(`A\n\n${NBSP}\n\nB`);

    // Stable: re-parsing/serializing keeps the spacer.
    expect(serialize(out)).toBe(`A\n\n${NBSP}\n\nB`);
  });

  it("preserves multiple consecutive spacer blocks", () => {
    const out = serialize("<p>A</p><p></p><p></p><p>B</p>");
    expect(out).toBe(`A\n\n${NBSP}\n\n${NBSP}\n\nB`);
  });

  it("does not emit a stray spacer for a trailing empty paragraph", () => {
    const out = serialize("<p>A</p><p></p>");
    expect(out).toBe("A");
  });

  it("leaves normal paragraphs untouched", () => {
    expect(serialize("<p>A</p><p>B</p>")).toBe("A\n\nB");
  });
});
