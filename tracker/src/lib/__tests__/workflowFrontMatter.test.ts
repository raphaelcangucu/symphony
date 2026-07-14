import { describe, expect, it } from "vitest";

import {
  readAgentEffort,
  readAgentKind,
  readAgentModel,
  writeAgentEffort,
  writeAgentKind,
  writeAgentModel,
} from "@/lib/workflowFrontMatter";

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

describe("agent.model and agent.effort front matter", () => {
  it("round-trips model and effort under agent:", () => {
    let md = writeAgentModel(BASE, "claude-opus-4-5");
    md = writeAgentEffort(md, "high");

    expect(readAgentModel(md)).toBe("claude-opus-4-5");
    expect(readAgentEffort(md)).toBe("high");
    expect(md).toContain("max_turns: 20");
  });

  it("clears model/effort to null and preserves sibling keys", () => {
    let md = writeAgentModel(BASE, "gpt-5-codex");
    md = writeAgentEffort(md, "medium");
    md = writeAgentModel(md, null);
    md = writeAgentEffort(md, null);

    expect(readAgentModel(md)).toBeNull();
    expect(readAgentEffort(md)).toBeNull();
    expect(md).toContain("max_turns: 20");
  });

  it("creates agent section for model when missing", () => {
    const md = writeAgentModel("---\ntracker:\n  active_states: []\n---\nBody.", "claude-sonnet-4-5");
    expect(readAgentModel(md)).toBe("claude-sonnet-4-5");
    expect(md).toContain("agent:\n  model: claude-sonnet-4-5");
  });
});
