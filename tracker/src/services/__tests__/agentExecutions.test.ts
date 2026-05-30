import { describe, expect, it } from "vitest";

import { normalizeAgentExecution } from "@/services/agentExecutions";

describe("normalizeAgentExecution", () => {
  it("strips leading hashes from issue identifiers", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "#508",
      status: "live",
    });

    expect(execution.issueIdentifier).toBe("508");
  });
});
