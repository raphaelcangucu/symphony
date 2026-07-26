import { describe, expect, it } from "vitest";

import { normalizeExecutionPayload, orchestratorRunRoute } from "./orchestrator-executions";

describe("orchestrator execution presentation", () => {
  it("normalizes list and streamed snapshot payloads from the selected host", () => {
    const list = normalizeExecutionPayload({
      executions: [
        {
          issue_identifier: "DEV-10",
          execution_session_id: 77,
          status: "live",
          agent_kind: "codex",
          model: null,
          last_message: "Implementing chat",
        },
      ],
    });
    const snapshot = normalizeExecutionPayload({
      data: [
        {
          issue_identifier: "DEV-11",
          execution_session_id: 78,
          status: "paused",
          agent_kind: "claude",
        },
      ],
    });

    expect(list).toEqual([
      expect.objectContaining({
        issueIdentifier: "DEV-10",
        executionSessionId: 77,
        status: "live",
        agentKind: "codex",
        model: null,
      }),
    ]);
    expect(snapshot[0]).toMatchObject({
      issueIdentifier: "DEV-11",
      executionSessionId: 78,
      status: "paused",
    });
  });

  it("drops rows that cannot open a real execution session", () => {
    expect(
      normalizeExecutionPayload({
        executions: [{ issue_identifier: "DEV-12", execution_session_id: null }],
      }),
    ).toEqual([]);
  });

  it("builds a direct host route for the execution transcript", () => {
    expect(orchestratorRunRoute("host alpha", 77, "DEV-10", "codex", "live")).toBe(
      "/h/host%20alpha/run/77?identifier=DEV-10&agent=codex&status=live",
    );
  });
});
