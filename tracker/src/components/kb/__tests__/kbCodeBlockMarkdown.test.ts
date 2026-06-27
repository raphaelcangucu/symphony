import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";

import { KbCodeBlock } from "@/components/kb/KbCodeBlock";

// Mirrors the KbEditor wiring: StarterKit's code block is disabled and replaced
// by KbCodeBlock. The Mermaid node view must not change how the block is
// serialized back to Markdown.
function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      KbCodeBlock,
      Markdown.configure({ html: true, linkify: false, breaks: false }),
    ],
    content: markdown,
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const out = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();
  return out;
}

describe("KB code block markdown round-trip", () => {
  it("preserves a mermaid fenced block with its language and source", () => {
    const md = ["# Architecture", "", "```mermaid", "flowchart TD", "  A --> B", "```"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart TD");
    expect(out).toContain("A --> B");
    // Regression guard: the fence language must not be dropped or duplicated.
    expect(out).not.toContain("``````");
  });

  it("keeps non-mermaid fenced code blocks intact", () => {
    const md = ["```ts", "const x = 1;", "```"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("```ts");
    expect(out).toContain("const x = 1;");
  });
});
