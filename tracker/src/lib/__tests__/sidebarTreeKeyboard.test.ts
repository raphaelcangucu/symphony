import { describe, expect, it } from "vitest";

import { resolveTreeKeyboardCommand } from "@/lib/sidebarTreeKeyboard";
import type { TreeKeyboardInput, TreeKeyboardRow } from "@/lib/sidebarTreeKeyboard";

const ROWS: readonly TreeKeyboardRow[] = [
  { id: "project", parentId: null, hasChildren: true, expanded: true },
  { id: "workspace", parentId: "project", hasChildren: true, expanded: false },
  { id: "session", parentId: "workspace", hasChildren: false, expanded: false },
  { id: "other", parentId: null, hasChildren: false, expanded: false },
];

function command(
  key: string,
  focusedId: string | null,
  overrides: Partial<TreeKeyboardInput> = {},
) {
  return resolveTreeKeyboardCommand({
    key,
    focusedId,
    rows: ROWS,
    menuOpen: false,
    ...overrides,
  });
}

describe("sidebar tree keyboard rules", () => {
  it("moves up and down within visible boundaries", () => {
    expect(command("ArrowDown", "project")).toEqual({ type: "focus", id: "workspace" });
    expect(command("ArrowUp", "workspace")).toEqual({ type: "focus", id: "project" });
    expect(command("ArrowUp", "project")).toEqual({ type: "focus", id: "project" });
    expect(command("ArrowDown", "other")).toEqual({ type: "focus", id: "other" });
  });

  it("moves home and end to boundary rows", () => {
    expect(command("Home", "session")).toEqual({ type: "focus", id: "project" });
    expect(command("End", "project")).toEqual({ type: "focus", id: "other" });
  });

  it("expands a collapsed parent or enters its first visible direct child", () => {
    expect(command("ArrowRight", "workspace")).toEqual({ type: "expand", id: "workspace" });
    expect(command("ArrowRight", "project")).toEqual({ type: "focus", id: "workspace" });
    expect(command("ArrowRight", "session")).toEqual({ type: "noop" });
  });

  it("collapses an expanded parent or focuses its parent", () => {
    expect(command("ArrowLeft", "project")).toEqual({ type: "collapse", id: "project" });
    expect(command("ArrowLeft", "session")).toEqual({ type: "focus", id: "workspace" });
    expect(command("ArrowLeft", "other")).toEqual({ type: "noop" });
  });

  it("opens the focused row with Enter", () => {
    expect(command("Enter", "workspace")).toEqual({ type: "open", id: "workspace" });
  });

  it("opens the focused menu only for Shift+F10", () => {
    expect(command("F10", "workspace", { shiftKey: true })).toEqual({
      type: "open-menu",
      id: "workspace",
    });
    expect(command("F10", "workspace")).toEqual({ type: "noop" });
  });

  it("closes an open menu on Escape and otherwise noops", () => {
    expect(command("Escape", "workspace", { menuOpen: true })).toEqual({
      type: "close-menu",
    });
    expect(command("Escape", "workspace")).toEqual({ type: "noop" });
    expect(command("Escape", null, { rows: [], menuOpen: true })).toEqual({
      type: "close-menu",
    });
  });

  it.each([
    ["ArrowUp", {}],
    ["ArrowDown", {}],
    ["Home", {}],
    ["End", {}],
    ["ArrowRight", {}],
    ["ArrowLeft", {}],
    ["Enter", {}],
    ["F10", { shiftKey: true }],
  ] as const)("ignores %s while a menu is open", (key, modifiers) => {
    expect(command(key, "workspace", { menuOpen: true, ...modifiers })).toEqual({
      type: "noop",
    });
  });

  it("ignores unsupported keys and modifier combinations", () => {
    expect(command("a", "workspace")).toEqual({ type: "noop" });
    expect(command("ArrowDown", "workspace", { ctrlKey: true })).toEqual({ type: "noop" });
    expect(command("Enter", "workspace", { shiftKey: true })).toEqual({ type: "noop" });
    expect(command("F10", "workspace", { shiftKey: true, altKey: true })).toEqual({
      type: "noop",
    });
  });

  it("handles empty rows and missing focused IDs safely", () => {
    expect(command("Home", null, { rows: [] })).toEqual({ type: "noop" });
    expect(command("ArrowDown", "missing")).toEqual({ type: "focus", id: "project" });
    expect(command("End", null)).toEqual({ type: "focus", id: "other" });
    expect(command("Enter", "missing")).toEqual({ type: "noop" });
  });

  it("does not enter a non-direct descendant when no visible child exists", () => {
    const rows: readonly TreeKeyboardRow[] = [
      { id: "project", parentId: null, hasChildren: true, expanded: true },
      { id: "other", parentId: null, hasChildren: false, expanded: false },
    ];
    expect(command("ArrowRight", "project", { rows })).toEqual({ type: "noop" });
  });

  it("does not scan across another subtree to find a later child", () => {
    const rows: readonly TreeKeyboardRow[] = [
      { id: "project", parentId: null, hasChildren: true, expanded: true },
      { id: "other", parentId: null, hasChildren: false, expanded: false },
      { id: "misordered-child", parentId: "project", hasChildren: false, expanded: false },
    ];
    expect(command("ArrowRight", "project", { rows })).toEqual({ type: "noop" });
  });

  it("does not focus a parent absent from the visible rows", () => {
    const rows: readonly TreeKeyboardRow[] = [
      { id: "session", parentId: "hidden", hasChildren: false, expanded: false },
    ];
    expect(command("ArrowLeft", "session", { rows })).toEqual({ type: "noop" });
  });
});
