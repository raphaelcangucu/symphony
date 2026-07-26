import { describe, expect, it } from "vitest";

import {
  assistantThreadDiffRoute,
  hostChatRoute,
  hostTerminalRoute,
  hostWorktreeRoute,
  sessionNotificationRoute,
} from "./session-navigation";

describe("unified Dev10x session navigation", () => {
  it("opens a host worktree in chat by default", () => {
    expect(hostChatRoute("host alpha", "42", "Studio Alpha")).toBe(
      "/h/host%20alpha/chat/42?name=Studio%20Alpha",
    );
  });

  it("keeps terminal as an explicit tool on the same host and thread", () => {
    expect(hostTerminalRoute("host alpha", "42", "Studio Alpha")).toBe(
      "/h/host%20alpha/session/42?name=Studio%20Alpha",
    );
  });

  it("routes a numeric assistant terminal to the thread-native diff surface", () => {
    expect(assistantThreadDiffRoute("42")).toBe("/session/42/diff");
    expect(assistantThreadDiffRoute("worktree-uuid")).toBeNull();
  });

  it("routes session notifications into the unified chat", () => {
    expect(sessionNotificationRoute("host alpha", "42")).toBe("/h/host%20alpha/chat/42");
  });

  it("opens orchestrator execution worktrees in the same rich chat backed by the run stream", () => {
    expect(
      hostWorktreeRoute({
        agentKind: "claude",
        hostId: "profile alpha",
        issueIdentifier: "DEV-42",
        name: "Improve mobile",
        scope: "issue_execution",
        status: "working",
        threadId: "73",
      }),
    ).toBe(
      "/h/profile%20alpha/run/73?identifier=DEV-42&agent=claude&status=live",
    );
  });

  it("keeps regular project sessions on the interactive chat transport", () => {
    expect(
      hostWorktreeRoute({
        hostId: "profile alpha",
        name: "Studio Alpha",
        scope: "project_session",
        threadId: "42",
      }),
    ).toBe("/h/profile%20alpha/chat/42?name=Studio%20Alpha");
  });
});
