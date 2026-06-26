import { Paragraph } from "@tiptap/extension-paragraph";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const NBSP = "\u00A0";

interface MarkdownSerializerState {
  write: (text: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
  renderInline: (node: ProseMirrorNode) => void;
}

/**
 * Markdown cannot represent an empty paragraph: any run of blank lines collapses
 * to a single separator, so the "spacer" blocks a user adds for vertical
 * breathing room are silently dropped on save. We preserve an intentional empty
 * paragraph by serializing it as a single non-breaking-space line, which
 * round-trips through Markdown and renders as a blank line (including on GitHub).
 *
 * A trailing empty paragraph (the block ProseMirror leaves under the caret) is
 * serialized with the default behavior so documents never accumulate a stray
 * spacer at the very end.
 */
export const KbSpacerParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownSerializerState,
          node: ProseMirrorNode,
          parent: ProseMirrorNode | null,
          index: number,
        ) {
          const isEmpty = node.content.size === 0;
          const isTrailing = !!parent && index === parent.childCount - 1;

          if (isEmpty && !isTrailing) {
            state.write(NBSP);
            state.closeBlock(node);
            return;
          }

          state.renderInline(node);
          state.closeBlock(node);
        },
      },
    };
  },
});
