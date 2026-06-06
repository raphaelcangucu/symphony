import { describe, expect, it } from "vitest";

import { readAgentKind, writeAgentKind } from "@/lib/workflowFrontMatter";

const BASE = `---
tracker:
  active_states:
    - Todo
agent:
  max_turns: 20
---

Prompt body.
`;

describe("readAgentKind", () => {
  it("returns null when agent.kind is absent", () => {
    expect(readAgentKind(BASE)).toBeNull();
    expect(readAgentKind("no front matter at all")).toBeNull();
    expect(readAgentKind("")).toBeNull();
  });

  it("reads an explicit kind", () => {
    const md = writeAgentKind(BASE, "claude");
    expect(readAgentKind(md)).toBe("claude");
  });
});

describe("writeAgentKind", () => {
  it("adds kind inside an existing agent section, preserving siblings", () => {
    const md = writeAgentKind(BASE, "claude");
    expect(md).toContain("agent:\n  kind: claude\n  max_turns: 20");
    expect(md).toContain("Prompt body.");
  });

  it("creates the agent section when missing", () => {
    const md = writeAgentKind("---\ntracker:\n  active_states: []\n---\nBody.", "codex");
    expect(md).toContain("agent:\n  kind: codex");
    expect(readAgentKind(md)).toBe("codex");
  });

  it("updates an existing kind in place", () => {
    const withClaude = writeAgentKind(BASE, "claude");
    const withCodex = writeAgentKind(withClaude, "codex");
    expect(readAgentKind(withCodex)).toBe("codex");
    expect(withCodex.match(/kind:/g)).toHaveLength(1);
  });

  it("removes the kind line when set to null, keeping other agent keys", () => {
    const withClaude = writeAgentKind(BASE, "claude");
    const cleared = writeAgentKind(withClaude, null);
    expect(readAgentKind(cleared)).toBeNull();
    expect(cleared).toContain("max_turns: 20");
  });

  it("removes the whole agent section when kind was its only key", () => {
    const md = writeAgentKind("---\ntracker:\n  active_states: []\n---\nBody.", "codex");
    const cleared = writeAgentKind(md, null);
    expect(cleared).not.toContain("agent:");
  });

  it("creates front matter when the document has none", () => {
    const md = writeAgentKind("Just a prompt.", "claude");
    expect(md.startsWith("---\nagent:\n  kind: claude\n---\n")).toBe(true);
    expect(md).toContain("Just a prompt.");
  });

  it("preserves CRLF line endings end-to-end", () => {
    const crlf = BASE.replace(/\n/g, "\r\n");
    const md = writeAgentKind(crlf, "claude");
    expect(md.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(md)).toBe(false); // no bare LFs
    expect(readAgentKind(md)).toBe("claude");
  });

  it("preserves an inline comment when updating kind", () => {
    const md = writeAgentKind(BASE, "claude").replace("kind: claude", 'kind: "claude"  # pinned');
    const updated = writeAgentKind(md, "codex");
    expect(updated).toContain("kind: codex # pinned");
    expect(readAgentKind(updated)).toBe("codex");
  });
});
