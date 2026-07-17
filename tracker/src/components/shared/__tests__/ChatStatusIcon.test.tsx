import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ChatStatusIcon,
  resolveSessionAgentStatus,
  sessionStatusIconKindFromScope,
} from "@/components/shared/ChatStatusIcon";

describe("ChatStatusIcon", () => {
  it("maps scopes to sidebar session icon kinds", () => {
    expect(sessionStatusIconKindFromScope("issue_execution")).toBe("execution");
    expect(sessionStatusIconKindFromScope("issue_session")).toBe("chat");
    expect(sessionStatusIconKindFromScope("issue")).toBe("authoring");
    expect(sessionStatusIconKindFromScope("project_session")).toBe("chat");
  });

  it("collapses agent status to idle / running / attention", () => {
    expect(resolveSessionAgentStatus({ statusKind: "active" })).toBe("idle");
    expect(resolveSessionAgentStatus({ statusKind: "idle" })).toBe("idle");
    expect(resolveSessionAgentStatus({ statusKind: "live" })).toBe("running");
    expect(resolveSessionAgentStatus({ statusKind: "running" })).toBe("running");
    expect(resolveSessionAgentStatus({ statusKind: "in_progress" })).toBe("running");
    expect(resolveSessionAgentStatus({ statusKind: "waiting" })).toBe("attention");
    expect(resolveSessionAgentStatus({ statusKind: "error" })).toBe("attention");
    expect(resolveSessionAgentStatus({ aggregateStatus: "attention" })).toBe("attention");
    expect(resolveSessionAgentStatus({ aggregateStatus: "error" })).toBe("attention");
    expect(resolveSessionAgentStatus({ aggregateStatus: "active" })).toBe("idle");
    expect(resolveSessionAgentStatus({ needsAttention: true })).toBe("attention");
    expect(resolveSessionAgentStatus({ executionStatus: "live" })).toBe("running");
    expect(resolveSessionAgentStatus({ executionStatus: "waiting" })).toBe("attention");
  });

  it("renders the glyph inside a circular badge", () => {
    const { container } = render(
      <ChatStatusIcon sessionKind="chat" statusKind="active" />,
    );
    const badge = container.firstElementChild;
    expect(badge?.className).toContain("rounded-full");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.querySelector("[role='img']")).not.toBeNull();
  });

  it("uses the agent-mode glyph when a mode is known", () => {
    const { container: plan } = render(
      <ChatStatusIcon sessionKind="chat" executionMode="plan" statusKind="idle" />,
    );
    const { container: build } = render(
      <ChatStatusIcon sessionKind="chat" executionMode="build" statusKind="idle" />,
    );
    const { container: noMode } = render(
      <ChatStatusIcon sessionKind="chat" executionMode={null} statusKind="idle" />,
    );

    expect(plan.querySelector("svg")).not.toBeNull();
    expect(plan.innerHTML).not.toBe(build.innerHTML);
    // Same kind, different mode → different glyphs; mode overrides the kind glyph.
    expect(plan.innerHTML).not.toBe(noMode.innerHTML);
  });
});
