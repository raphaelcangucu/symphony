import { describe, expect, it } from "vitest";

import { buildDefaultWorkflowMarkdown, initialWorkflowMarkdown, splitWorkflowMarkdown } from "@/lib/workflowMarkdown";

describe("workflowMarkdown helpers", () => {
  it("splits front matter and body", () => {
    const parts = splitWorkflowMarkdown("---\ntracker:\n  active_states: [Todo]\n---\n\nHello");
    expect(parts.frontMatter).toContain("active_states");
    expect(parts.body).toBe("Hello");
  });

  it("uses stored markdown when present", () => {
    const stored = "---\ntracker:\n  active_states: [Done]\n---\n\nBody";
    expect(initialWorkflowMarkdown(stored, [])).toBe(stored);
  });

  it("builds a default template from statuses when empty", () => {
    const markdown = buildDefaultWorkflowMarkdown([
      { id: "1", name: "Todo", category: "active", position: 0, isTerminal: false },
      { id: "2", name: "Done", category: "terminal", position: 1, isTerminal: true },
    ]);
    expect(markdown).toContain("active_states: [Todo]");
    expect(markdown).toContain("terminal_states: [Done]");
  });
});
