import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const onNodeChangeRefs: Array<((...args: unknown[]) => void) | undefined> = [];

vi.mock("@tiptap/extension-drag-handle-react", () => ({
  DragHandle: ({
    children,
    onNodeChange,
  }: {
    children: ReactNode;
    onNodeChange?: (...args: unknown[]) => void;
  }) => {
    onNodeChangeRefs.push(onNodeChange);
    return <div data-testid="drag-handle">{children}</div>;
  },
}));

import { KbBlockHandle } from "@/components/kb/KbBlockHandle";

describe("KbBlockHandle", () => {
  beforeEach(() => {
    onNodeChangeRefs.length = 0;
  });

  it("keeps onNodeChange referentially stable when the insert menu opens", () => {
    // TipTap's DragHandle re-registers its ProseMirror plugin whenever
    // onNodeChange changes identity. registerPlugin updates the editor, which
    // re-renders the parent, which recreates an inline onNodeChange — infinite
    // update loop (React #185) after clicking Add.
    render(<KbBlockHandle editor={{} as Editor} />);

    expect(onNodeChangeRefs.length).toBeGreaterThanOrEqual(1);
    const initial = onNodeChangeRefs[0];

    fireEvent.click(screen.getByRole("button", { name: "Add block below" }));
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();

    const afterOpen = onNodeChangeRefs[onNodeChangeRefs.length - 1];
    expect(afterOpen).toBe(initial);
  });
});
