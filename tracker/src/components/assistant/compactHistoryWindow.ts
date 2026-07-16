export interface CompactHistoryWindow {
  /** Index of the first message to show when history is collapsed. */
  startIndex: number;
  /** Number of user prompts hidden before `startIndex`. */
  hiddenPromptCount: number;
}

/** How many older user prompts each "Load old prompts" click reveals in-memory. */
export const LOAD_OLDER_PROMPT_PAGE_SIZE = 10;

type RoleOnly = { role: string };

/**
 * Computes the "current run" window: the transcript from the latest user prompt
 * onward. Collapsing to this window avoids rendering (and re-parsing) the entire
 * thread on open. When there is no user message, the last message is shown so
 * the list is never blank.
 */
export function getCurrentPromptWindow(messages: readonly RoleOnly[]): CompactHistoryWindow {
  if (messages.length === 0) return { startIndex: 0, hiddenPromptCount: 0 };

  let startIndex = messages.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      startIndex = index;
      break;
    }
  }

  return { startIndex, hiddenPromptCount: countHiddenPromptsBefore(messages, startIndex) };
}

/** Counts user prompts strictly before `startIndex`. */
export function countHiddenPromptsBefore(messages: readonly RoleOnly[], startIndex: number): number {
  if (!Number.isInteger(startIndex) || startIndex <= 0) return 0;

  const end = Math.min(startIndex, messages.length);
  let hiddenPromptCount = 0;
  for (let index = 0; index < end; index++) {
    if (messages[index]?.role === "user") hiddenPromptCount++;
  }
  return hiddenPromptCount;
}

/**
 * Walks backward from `currentStartIndex` and returns a new start index that
 * includes up to `pageSize` additional older user prompts (and their turns).
 */
export function revealOlderPromptStartIndex(
  messages: readonly RoleOnly[],
  currentStartIndex: number,
  pageSize: number = LOAD_OLDER_PROMPT_PAGE_SIZE,
): number {
  if (!Number.isInteger(currentStartIndex) || currentStartIndex <= 0) return 0;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer");
  }

  const boundedStart = Math.min(currentStartIndex, messages.length);
  let remaining = pageSize;
  let nextStart = 0;

  for (let index = boundedStart - 1; index >= 0; index--) {
    if (messages[index]?.role !== "user") continue;
    remaining--;
    nextStart = index;
    if (remaining === 0) break;
  }

  return nextStart;
}

/**
 * Prepends an older page of messages ahead of the in-memory list, dropping any
 * older entries whose id already exists (server pages are exclusive of the
 * current window, but streaming placeholders and re-sync overlap can collide).
 * Returns the current list unchanged when there is nothing new to prepend.
 */
export function mergeOlderMessages<T extends { id: string }>(older: readonly T[], current: readonly T[]): T[] {
  if (older.length === 0) return [...current];

  const currentIds = new Set(current.map((message) => message.id));
  const deduped = older.filter((message) => !currentIds.has(message.id));
  if (deduped.length === 0) return [...current];

  return [...deduped, ...current];
}
