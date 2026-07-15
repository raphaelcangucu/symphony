export interface CompactHistoryWindow {
  /** Index of the first message to show when history is collapsed. */
  startIndex: number;
  /** Number of user prompts hidden before `startIndex`. */
  hiddenPromptCount: number;
}

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

  let hiddenPromptCount = 0;
  for (let index = 0; index < startIndex; index++) {
    if (messages[index]?.role === "user") hiddenPromptCount++;
  }

  return { startIndex, hiddenPromptCount };
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
