import { describe, expect, it, vi } from "vitest";

import { followLatestMessage } from "./chat-scroll";

describe("rich chat scrolling", () => {
  it("keeps a newly streamed user or assistant message visible", () => {
    const list = { scrollToEnd: vi.fn() };

    followLatestMessage(list);

    expect(list.scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });
});
