import { describe, expect, it } from "vitest";

import { parseSubagentNotification } from "@/lib/subagentNotification";

function wrap(json: string): string {
  return `<subagent_notification>\n${json}\n</subagent_notification>`;
}

describe("parseSubagentNotification", () => {
  it("parses completed status with markdown detail and success tone", () => {
    const body = wrap(
      JSON.stringify({
        agent_path: "019f7186-95e7-7a91-ac42-e918d56f7b06",
        status: {
          completed:
            "CHANGES_REQUESTED\n\n**Findings**\n- [file.php:18](/abs/path/file.php:18) note",
        },
      }),
    );

    expect(parseSubagentNotification(body)).toEqual({
      agentId: "019f7186-95e7-7a91-ac42-e918d56f7b06",
      headline: "CHANGES_REQUESTED",
      tone: "warning",
      detail: "**Findings**\n- [file.php:18](/abs/path/file.php:18) note",
    });
  });

  it("strips a Status: prefix from the headline line", () => {
    const body = wrap(
      JSON.stringify({
        agent_path: "agent-1",
        status: { completed: "Status: DONE_WITH_CONCERNS\n\nSomething to watch." },
      }),
    );

    expect(parseSubagentNotification(body)).toEqual({
      agentId: "agent-1",
      headline: "DONE_WITH_CONCERNS",
      tone: "warning",
      detail: "Something to watch.",
    });
  });

  it("splits APPROVED: rest into headline and detail", () => {
    const body = wrap(
      JSON.stringify({
        agent_path: "agent-2",
        status: { completed: "APPROVED: task matches spec\n\nExtra notes." },
      }),
    );

    expect(parseSubagentNotification(body)).toEqual({
      agentId: "agent-2",
      headline: "APPROVED",
      tone: "success",
      detail: "task matches spec\n\nExtra notes.",
    });
  });

  it("parses a plain string status like shutdown", () => {
    const body = wrap(
      JSON.stringify({
        agent_path: "agent-3",
        status: "shutdown",
      }),
    );

    expect(parseSubagentNotification(body)).toEqual({
      agentId: "agent-3",
      headline: "shutdown",
      tone: "neutral",
      detail: null,
    });
  });

  it("returns a fallback notification for malformed JSON inside the tags", () => {
    const malformed = "<subagent_notification>\n{not-json\n</subagent_notification>";

    expect(parseSubagentNotification(malformed)).toEqual({
      agentId: null,
      headline: "update",
      tone: "neutral",
      detail: "{not-json",
    });
  });

  it("returns null for non-notification bodies", () => {
    expect(parseSubagentNotification(null)).toBeNull();
    expect(parseSubagentNotification(undefined)).toBeNull();
    expect(parseSubagentNotification("hello")).toBeNull();
    expect(parseSubagentNotification("<subagent_notification>no close")).toBeNull();
    expect(parseSubagentNotification("  leading text <subagent_notification>{}</subagent_notification>")).toBeNull();
  });

  it("allows leading whitespace before the open tag", () => {
    const body = `  \n${wrap(JSON.stringify({ agent_path: "a", status: { completed: "DONE" } }))}`;
    expect(parseSubagentNotification(body)).toMatchObject({
      agentId: "a",
      headline: "DONE",
      tone: "success",
      detail: null,
    });
  });
});
