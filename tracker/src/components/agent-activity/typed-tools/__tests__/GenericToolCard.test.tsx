import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GenericToolCard } from "@/components/agent-activity/typed-tools/GenericToolCard";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

const presentation: ToolPresentation = {
  family: "generic_mcp",
  toolName: "scan_project_setup",
  title: "Scan project setup",
  summary: "advising",
  status: "completed",
  badges: [{ kind: "ok", label: "ok" }],
  links: [],
  body: null,
  raw: '{"noise":true}',
  meta: {},
};

describe("GenericToolCard", () => {
  it("shows human title and not raw JSON by default", () => {
    render(<GenericToolCard presentation={presentation} />);
    expect(screen.getByText("Scan project setup")).toBeTruthy();
    expect(screen.queryByText('{"noise":true}')).toBeNull();
  });
});
