import { describe, expect, it } from "vitest";

import type { Issue } from "@/types/issue";
import {
  DEFAULT_WORKFLOW_STATUSES,
  buildBoardState,
  moveIssueLocally,
  parseDragIssueId,
} from "../board-utils";

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.id ?? overrides.identifier ?? "issue-id",
    identifier: overrides.identifier ?? "MAC-1",
    projectSlug: overrides.projectSlug ?? "macro-markets",
    status: overrides.status ?? "Todo",
    title: overrides.title ?? "Issue",
    description: overrides.description ?? null,
    priority: overrides.priority ?? null,
    position: overrides.position ?? 0,
    labels: overrides.labels ?? [],
    blockedBy: overrides.blockedBy ?? [],
    assignee: overrides.assignee ?? null,
    createdAt: overrides.createdAt ?? "2026-05-27T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-05-27T00:00:00Z",
  };
}

describe("board-utils", () => {
  it("builds all default workflow columns in position order", () => {
    const board = buildBoardState([
      issue({ identifier: "MAC-2", status: "Todo", position: 2 }),
      issue({ identifier: "MAC-1", status: "Todo", position: 1 }),
    ]);

    expect(Object.keys(board)).toEqual(DEFAULT_WORKFLOW_STATUSES);
    expect(board.Todo.map((item) => item.identifier)).toEqual(["MAC-1", "MAC-2"]);
    expect(board.Done).toEqual([]);
  });

  it("builds custom workflow columns from project statuses", () => {
    const board = buildBoardState(
      [
        issue({ identifier: "MAC-1", status: "Review", position: 0 }),
        issue({ identifier: "MAC-2", status: "Todo", position: 0 }),
      ],
      ["Todo", "Review", "Done"],
    );

    expect(Object.keys(board)).toEqual(["Todo", "Review", "Done"]);
    expect(board.Review.map((item) => item.identifier)).toEqual(["MAC-1"]);
  });

  it("moves an issue between columns without mutating the original board", () => {
    const board = buildBoardState([
      issue({ identifier: "MAC-1", status: "Todo", position: 0 }),
      issue({ identifier: "MAC-2", status: "In Progress", position: 0 }),
    ]);

    const next = moveIssueLocally(board, "MAC-1", "In Progress", 0);

    expect(next.Todo).toHaveLength(0);
    expect(next["In Progress"].map((item) => item.identifier)).toEqual(["MAC-1", "MAC-2"]);
    expect(next["In Progress"][0]).toMatchObject({ status: "In Progress", position: 0 });
    expect(next["In Progress"][1]).toMatchObject({ status: "In Progress", position: 1 });
    expect(board.Todo).toHaveLength(1);
  });

  it("clamps target indexes and keeps same-column moves ordered", () => {
    const board = buildBoardState([
      issue({ identifier: "MAC-1", status: "Todo", position: 0 }),
      issue({ identifier: "MAC-2", status: "Todo", position: 1 }),
    ]);

    const next = moveIssueLocally(board, "MAC-1", "Todo", 99);

    expect(next.Todo.map((item) => item.identifier)).toEqual(["MAC-2", "MAC-1"]);
    expect(next.Todo.map((item) => item.position)).toEqual([0, 1]);
  });

  it("returns the same board object when the issue is not present", () => {
    const board = buildBoardState([issue({ identifier: "MAC-1" })]);

    expect(moveIssueLocally(board, "MAC-404", "Done", 0)).toBe(board);
  });

  it("parses sortable card ids defensively", () => {
    expect(parseDragIssueId("issue:MAC-1")).toBe("MAC-1");
    expect(parseDragIssueId("MAC-1")).toBe("MAC-1");
    expect(parseDragIssueId(null)).toBeNull();
    expect(parseDragIssueId("")).toBeNull();
  });
});
