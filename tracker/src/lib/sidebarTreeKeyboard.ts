export interface TreeKeyboardRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

export interface TreeKeyboardInput {
  readonly key: string;
  readonly focusedId: string | null;
  readonly rows: readonly TreeKeyboardRow[];
  readonly menuOpen: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

export type TreeKeyboardCommand =
  | { readonly type: "focus"; readonly id: string }
  | { readonly type: "expand"; readonly id: string }
  | { readonly type: "collapse"; readonly id: string }
  | { readonly type: "open"; readonly id: string }
  | { readonly type: "open-menu"; readonly id: string }
  | { readonly type: "close-menu" }
  | { readonly type: "noop" };

const NOOP: TreeKeyboardCommand = Object.freeze({ type: "noop" });

export function resolveTreeKeyboardCommand(input: TreeKeyboardInput): TreeKeyboardCommand {
  if (!isInput(input)) return NOOP;
  if (input.menuOpen) {
    return input.key === "Escape" ? { type: "close-menu" } : NOOP;
  }
  if (input.ctrlKey || input.altKey || input.metaKey) return NOOP;
  if (input.shiftKey && input.key !== "F10") return NOOP;
  if (input.key === "Escape") return NOOP;

  const rows = input.rows.filter(isValidRow);
  if (rows.length === 0) return NOOP;

  const focusedIndex = rows.findIndex((row) => row.id === input.focusedId);
  const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : null;

  if (input.key === "Home") return focus(rows[0].id);
  if (input.key === "End") return focus(rows.at(-1)!.id);

  if (input.key === "ArrowDown" || input.key === "ArrowUp") {
    if (!focusedRow) return focus(rows[0].id);
    const delta = input.key === "ArrowDown" ? 1 : -1;
    const targetIndex = Math.min(rows.length - 1, Math.max(0, focusedIndex + delta));
    return focus(rows[targetIndex].id);
  }

  if (!focusedRow) return NOOP;
  switch (input.key) {
    case "ArrowRight": {
      if (focusedRow.hasChildren && !focusedRow.expanded) {
        return { type: "expand", id: focusedRow.id };
      }
      if (!focusedRow.hasChildren || !focusedRow.expanded) return NOOP;
      const immediateNextRow = rows[focusedIndex + 1];
      return immediateNextRow?.parentId === focusedRow.id
        ? focus(immediateNextRow.id)
        : NOOP;
    }
    case "ArrowLeft":
      if (focusedRow.hasChildren && focusedRow.expanded) {
        return { type: "collapse", id: focusedRow.id };
      }
      return focusedRow.parentId && rows.some((row) => row.id === focusedRow.parentId)
        ? focus(focusedRow.parentId)
        : NOOP;
    case "Enter":
      return { type: "open", id: focusedRow.id };
    case "F10":
      return input.shiftKey ? { type: "open-menu", id: focusedRow.id } : NOOP;
    default:
      return NOOP;
  }
}

function focus(id: string): TreeKeyboardCommand {
  return { type: "focus", id };
}

function isInput(value: unknown): value is TreeKeyboardInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<TreeKeyboardInput>;
  return (
    typeof input.key === "string" &&
    Array.isArray(input.rows) &&
    (input.focusedId === null || typeof input.focusedId === "string") &&
    typeof input.menuOpen === "boolean"
  );
}

function isValidRow(value: unknown): value is TreeKeyboardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TreeKeyboardRow>;
  return (
    typeof row.id === "string" &&
    row.id.trim().length > 0 &&
    (row.parentId === null || typeof row.parentId === "string") &&
    typeof row.hasChildren === "boolean" &&
    typeof row.expanded === "boolean"
  );
}
