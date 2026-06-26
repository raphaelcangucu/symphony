import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";

import { KbImage } from "@/components/kb/KbImageExtension";

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, linkify: false, breaks: false }),
    ],
    content: markdown,
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const out = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();
  return out;
}

function roundTripKbImage(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit,
      KbImage.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: true, linkify: false, breaks: false }),
    ],
    content: markdown,
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const out = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();
  return out;
}

describe("KB editor markdown round-trip", () => {
  it("preserves GFM tables instead of flattening them to text", () => {
    const md = [
      "# Analytics",
      "",
      "| Value | Description |",
      "| --- | --- |",
      "| `A` | first |",
      "| `B` | second |",
    ].join("\n");

    const out = roundTrip(md);

    expect(out).toMatch(/\|\s*Value\s*\|\s*Description\s*\|/);
    expect(out).toMatch(/\|\s*`A`\s*\|\s*first\s*\|/);
    expect(out).toMatch(/\|\s*`B`\s*\|\s*second\s*\|/);
    // Regression guard: the old (table-less) editor produced "ValueDescription".
    expect(out).not.toContain("ValueDescription");
  });

  it("keeps headings and fenced code blocks intact", () => {
    const md = ["## Title", "", "```ts", "const x = 1;", "```"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("## Title");
    expect(out).toContain("```");
    expect(out).toContain("const x = 1;");
  });

  it("preserves markdown image syntax", () => {
    const md = "![logo](../assets/abc123.png)";
    const out = roundTrip(md);
    expect(out).toMatch(/!\[logo\]\([^)]+\)/);
  });

  it("keeps plain KB images as portable markdown", () => {
    const out = roundTripKbImage("![logo](../assets/abc123.png)");
    expect(out).toMatch(/!\[logo\]\(\.\.\/assets\/abc123\.png\)/);
    expect(out).not.toContain("<img");
  });

  it("serializes aligned/sized KB images as a single html img tag", () => {
    const md = '<img src="../assets/abc123.png" alt="logo" style="width: 66%" data-align="center" />';
    const out = roundTripKbImage(md);
    expect(out).toContain("<img");
    expect(out).toContain('src="../assets/abc123.png"');
    expect(out).toContain('alt="logo"');
    expect(out).toContain("width: 66%");
    expect(out).toContain('data-align="center"');
    // Aligned/sized images must NOT collapse to plain markdown (which would drop the attributes).
    expect(out).not.toMatch(/!\[logo\]\(/);
  });
});
