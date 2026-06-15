import { describe, expect, it } from "vitest";

import { isWaitState, parseWorkflowTrackerConfig } from "@/lib/workflowTracker";

const advisingWorkflow = `---
tracker:
  active_states:
    - Selected for Development
    - Em andamento
  dispatch_states:
    - Selected for Development
  wait_states:
    - Revisão de pares
  terminal_states:
    - Concluído
---
Body
`;

describe("workflowTracker", () => {
  it("parses wait states and infers rework target from active states", () => {
    const config = parseWorkflowTrackerConfig(advisingWorkflow);

    expect(config.waitStates).toEqual(["Revisão de pares"]);
    expect(config.reworkTarget).toBe("Em andamento");
    expect(isWaitState("Revisão de pares", config)).toBe(true);
    expect(isWaitState("Em andamento", config)).toBe(false);
  });
});
