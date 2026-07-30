export type ComposerActionId =
  | "files"
  | "context"
  | "diff"
  | "kb"
  | "magic"
  | "goal"
  | "commands";

export interface ComposerActionContext {
  hasWorkspace: boolean;
  supportsGoal: boolean;
}

export type ComposerActionHandlers = Record<ComposerActionId, () => void>;

export const COMPOSER_ACTION_IDS: readonly ComposerActionId[] = [
  "files",
  "context",
  "diff",
  "kb",
  "magic",
  "goal",
  "commands",
];

export function visibleComposerActions(
  context: ComposerActionContext,
): readonly ComposerActionId[] {
  return COMPOSER_ACTION_IDS.filter(
    (id) => id !== "diff" || context.hasWorkspace,
  );
}
