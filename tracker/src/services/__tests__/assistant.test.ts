import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAssistantMessage } from "@/services/assistant";
import { http } from "@/services/http";

describe("assistant service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts project assistant messages and normalizes tool issue results", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          assistant_message: "Created issue MAC-1: Add assistant panel",
          tool_calls: [
            {
              name: "create_issue",
              status: "complete",
              result: {
                issue: {
                  id: 1,
                  identifier: "MAC-1",
                  project_slug: "macro-markets",
                  title: "Add assistant panel",
                  status: { name: "Todo" },
                },
              },
            },
          ],
        },
      },
    });

    const response = await sendAssistantMessage("macro-markets", {
      message: "create issue: Add assistant panel",
      context: { view: "board" },
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/assistant/messages", {
      message: "create issue: Add assistant panel",
      context: { view: "board" },
    });
    expect(response.assistantMessage).toBe("Created issue MAC-1: Add assistant panel");
    expect(response.toolCalls[0]).toMatchObject({
      name: "create_issue",
      status: "complete",
      result: {
        issue: {
          identifier: "MAC-1",
          title: "Add assistant panel",
          projectSlug: "macro-markets",
        },
      },
    });
  });

  it("fails fast for blank project slugs and messages", async () => {
    await expect(sendAssistantMessage(" ", { message: "hello" })).rejects.toThrow("projectSlug is required");
    await expect(sendAssistantMessage("macro-markets", { message: " " })).rejects.toThrow("message is required");
  });
});
