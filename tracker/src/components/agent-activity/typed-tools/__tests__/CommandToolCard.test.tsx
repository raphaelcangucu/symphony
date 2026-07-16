import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandToolCard } from "@/components/agent-activity/typed-tools/CommandToolCard";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

describe("CommandToolCard", () => {
  it("renders command description and exit badge", () => {
    const presentation: ToolPresentation = {
      family: "command",
      toolName: "Bash",
      title: "Run GranteeAutocomplete unit tests",
      summary: "yarn test · GranteeAutocomplete.test.js",
      status: "completed",
      badges: [{ kind: "ok", label: "exit 0" }],
      links: [],
      body: "PASS 4 tests",
      raw: null,
      meta: { exitCode: 0 },
    };
    render(<CommandToolCard presentation={presentation} />);
    expect(screen.getByText("Run GranteeAutocomplete unit tests")).toBeTruthy();
    expect(screen.getByText(/exit 0/i)).toBeTruthy();
  });
});
