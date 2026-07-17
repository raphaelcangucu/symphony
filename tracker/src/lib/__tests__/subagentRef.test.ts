import { describe, expect, it } from "vitest";
import { getSubagentRef } from "@/lib/subagentRef";

describe("getSubagentRef", () => {
  describe("spawn_agent (Codex)", () => {
    it("resolves from object output", () => {
      const ref = getSubagentRef({
        toolName: "spawn_agent",
        args: {
          agent_type: "worker",
          message: "Review the auth module\nInclude edge cases",
        },
        output: {
          agent_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          nickname: "auth-reviewer",
        },
      });

      expect(ref).toEqual({
        resolve: "id",
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        nickname: "auth-reviewer",
        subagentType: "worker",
        taskPreview: "Review the auth module",
      });
    });

    it("resolves from JSON-string output", () => {
      const ref = getSubagentRef({
        toolName: "Spawn_Agent",
        args: { task: "Implement login form" },
        output: JSON.stringify({
          agent_id: "deadbeef-0000-1111-2222-333344445555",
          nickname: "login-impl",
        }),
      });

      expect(ref).toMatchObject({
        resolve: "id",
        id: "deadbeef-0000-1111-2222-333344445555",
        nickname: "login-impl",
        taskPreview: "Implement login form",
      });
    });

    it("returns null when agent_id is missing", () => {
      const ref = getSubagentRef({
        toolName: "spawn_agent",
        args: { message: "Do work" },
        output: { nickname: "orphan" },
      });
      expect(ref).toBeNull();
    });

    it("returns null when agent_id is invalid", () => {
      const ref = getSubagentRef({
        toolName: "spawn_agent",
        args: { message: "Do work" },
        output: { agent_id: "not an id!" },
      });
      expect(ref).toBeNull();
    });

    it("returns null for malformed JSON-string output", () => {
      const ref = getSubagentRef({
        toolName: "spawn_agent",
        args: { message: "Do work" },
        output: "{not-json",
      });
      expect(ref).toBeNull();
    });
  });

  describe("TaskCreate (Claude)", () => {
    it("resolves with toolu toolCallId", () => {
      const ref = getSubagentRef({
        toolName: "TaskCreate",
        args: {
          subject: "Explore billing edge cases",
          subagent_type: "Explore",
        },
        output: null,
        toolCallId: "toolu_01AbCdEfGhIjKlMn",
      });

      expect(ref).toEqual({
        resolve: "toolUseId",
        toolUseId: "toolu_01AbCdEfGhIjKlMn",
        subagentType: "Explore",
        taskPreview: "Explore billing edge cases",
      });
    });

    it("returns null without toolCallId", () => {
      const ref = getSubagentRef({
        toolName: "TaskCreate",
        args: { description: "Something" },
        output: null,
      });
      expect(ref).toBeNull();
    });

    it("returns null when toolCallId does not start with toolu", () => {
      const ref = getSubagentRef({
        toolName: "taskcreate",
        args: { subject: "Something" },
        output: null,
        toolCallId: "call_abc123",
      });
      expect(ref).toBeNull();
    });
  });

  describe("Task (Cursor)", () => {
    it("resolves with prompt", () => {
      const ref = getSubagentRef({
        toolName: "Task",
        args: {
          description: "Find auth bugs",
          prompt: "Search the codebase for auth vulnerabilities.",
          subagentType: "explore",
        },
        output: null,
      });

      expect(ref).toEqual({
        resolve: "matchPrompt",
        matchPrompt: "Search the codebase for auth vulnerabilities.",
        subagentType: "explore",
        taskPreview: "Find auth bugs",
      });
    });

    it("returns null without prompt or description", () => {
      const ref = getSubagentRef({
        toolName: "task",
        args: { subagent_type: "explore" },
        output: null,
      });
      expect(ref).toBeNull();
    });
  });

  describe("non-spawn tools", () => {
    it("returns null for taskupdate", () => {
      expect(
        getSubagentRef({
          toolName: "TaskUpdate",
          args: { prompt: "ignored" },
          output: null,
          toolCallId: "toolu_01AbCd",
        }),
      ).toBeNull();
    });

    it("returns null for todowrite", () => {
      expect(
        getSubagentRef({
          toolName: "TodoWrite",
          args: { prompt: "ignored" },
          output: null,
        }),
      ).toBeNull();
    });
  });
});
