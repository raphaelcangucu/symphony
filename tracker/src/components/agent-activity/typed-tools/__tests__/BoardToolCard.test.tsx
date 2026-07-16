import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BoardToolCard } from "@/components/agent-activity/typed-tools/BoardToolCard";

describe("BoardToolCard", () => {
  it("shows issue id and new status for board action", () => {
    render(
      <BoardToolCard
        presentation={{
          family: "board_action",
          toolName: "set_issue_status",
          title: "CDE-1180 movido",
          summary: "status → Em andamento",
          status: "completed",
          badges: [{ kind: "ok", label: "ok" }],
          links: [],
          body: null,
          raw: null,
          meta: { issue_id: "CDE-1180", status: "Em andamento" },
        }}
      />,
    );
    expect(screen.getByText(/CDE-1180/)).toBeTruthy();
    expect(screen.getByText(/Em andamento/)).toBeTruthy();
  });
});
