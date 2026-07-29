import { describe, expect, it } from "vitest";

import { taskCreationActivity } from "./task-creation-activity";

describe("taskCreationActivity", () => {
  it("recognizes a task created through the shared Symphony tool", () => {
    expect(taskCreationActivity("create_issue", "Created issue VIN-2: Add health check")).toEqual({
      identifier: "VIN-2",
      kind: "task",
      parentIdentifier: null,
      title: "Add health check",
      unitType: null,
    });
  });

  it("recognizes a generated subtask and its orchestration parent", () => {
    expect(
      taskCreationActivity(
        "create_subtask",
        "Created workpad_task subtask VIN-3 under VIN-1 (orchestration_mode=unified).",
      ),
    ).toEqual({
      identifier: "VIN-3",
      kind: "subtask",
      parentIdentifier: "VIN-1",
      title: null,
      unitType: "workpad_task",
    });
  });

  it("does not promote unrelated tools into task cards", () => {
    expect(taskCreationActivity("exec_command", "Created issue VIN-2: not a tracker event")).toBeNull();
  });
});
