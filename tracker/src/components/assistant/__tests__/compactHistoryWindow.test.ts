import { describe, expect, it } from "vitest";

import { getCurrentPromptWindow, mergeOlderMessages } from "@/components/assistant/compactHistoryWindow";

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
