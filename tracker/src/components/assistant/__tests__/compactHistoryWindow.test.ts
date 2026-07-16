import { describe, expect, it } from "vitest";

import {
  countHiddenPromptsBefore,
  getCurrentPromptWindow,
  LOAD_OLDER_PROMPT_PAGE_SIZE,
  mergeOlderMessages,
  revealOlderPromptStartIndex,
} from "@/components/assistant/compactHistoryWindow";

function promptThread(promptCount: number) {
  const messages: Array<{ role: string }> = [];
  for (let index = 0; index < promptCount; index++) {
    messages.push({ role: "user" }, { role: "assistant" });
  }
  return messages;
}

describe("getCurrentPromptWindow", () => {
  it("returns an empty window for no messages", () => {
    expect(getCurrentPromptWindow([])).toEqual({ startIndex: 0, hiddenPromptCount: 0 });
  });

  it("starts at the latest user prompt and counts older user prompts", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
    ];

    expect(getCurrentPromptWindow(messages)).toEqual({ startIndex: 2, hiddenPromptCount: 1 });
  });

  it("falls back to the last message when there is no user role", () => {
    const messages = [{ role: "assistant" }, { role: "assistant" }];

    expect(getCurrentPromptWindow(messages)).toEqual({ startIndex: 1, hiddenPromptCount: 0 });
  });

  it("keeps a single latest user prompt visible with nothing hidden", () => {
    const messages = [{ role: "user" }];

    expect(getCurrentPromptWindow(messages)).toEqual({ startIndex: 0, hiddenPromptCount: 0 });
  });
});

describe("revealOlderPromptStartIndex", () => {
  it("defaults the page size to 10 prompts", () => {
    expect(LOAD_OLDER_PROMPT_PAGE_SIZE).toBe(10);
  });

  it("reveals at most 10 older user prompts per click", () => {
    const messages = promptThread(15);
    const currentStart = getCurrentPromptWindow(messages).startIndex;

    const nextStart = revealOlderPromptStartIndex(messages, currentStart);

    expect(countHiddenPromptsBefore(messages, nextStart)).toBe(4);
    expect(messages[nextStart]?.role).toBe("user");
  });

  it("stops at the beginning when fewer than a page of prompts remain", () => {
    const messages = promptThread(3);
    const currentStart = getCurrentPromptWindow(messages).startIndex;

    expect(revealOlderPromptStartIndex(messages, currentStart)).toBe(0);
  });

  it("can reveal another page from a partially expanded start index", () => {
    const messages = promptThread(25);
    const afterFirst = revealOlderPromptStartIndex(messages, getCurrentPromptWindow(messages).startIndex);
    const afterSecond = revealOlderPromptStartIndex(messages, afterFirst);

    expect(countHiddenPromptsBefore(messages, afterFirst)).toBe(14);
    expect(countHiddenPromptsBefore(messages, afterSecond)).toBe(4);
  });

  it("stays at 0 when already fully revealed", () => {
    expect(revealOlderPromptStartIndex(promptThread(2), 0)).toBe(0);
  });
});

describe("mergeOlderMessages", () => {
  it("prepends older messages ahead of the current list", () => {
    const older = [{ id: "1" }, { id: "2" }];
    const current = [{ id: "3" }, { id: "4" }];

    expect(mergeOlderMessages(older, current)).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]);
  });

  it("drops older entries whose id already exists in the current list", () => {
    const older = [{ id: "1" }, { id: "3" }];
    const current = [{ id: "3" }, { id: "4" }];

    expect(mergeOlderMessages(older, current)).toEqual([{ id: "1" }, { id: "3" }, { id: "4" }]);
  });

  it("returns a copy of the current list when there is nothing new to prepend", () => {
    const current = [{ id: "3" }, { id: "4" }];

    expect(mergeOlderMessages([], current)).toEqual(current);
    expect(mergeOlderMessages([{ id: "3" }], current)).toEqual(current);
    expect(mergeOlderMessages([], current)).not.toBe(current);
  });
});
