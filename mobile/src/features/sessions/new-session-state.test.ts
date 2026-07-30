import { describe, expect, it } from "vitest";

import {
  buildCreateThreadInput,
  createInitialNewSessionState,
  deriveSessionTitle,
  newSessionReducer,
  validateNewSession,
  validateSessionPrompt,
} from "./new-session-state";

describe("new session state", () => {
  it("creates a stable request key that is included in every creation payload", () => {
    const state = createInitialNewSessionState(() => "request-123");

    expect(state.requestKey).toBe("request-123");
    expect(buildCreateThreadInput(state)).toMatchObject({ requestKey: "request-123" });
  });
  it("maps project workspace context into a project-session payload", () => {
    expect(
      buildCreateThreadInput({
        ...createInitialNewSessionState(() => "request-123"),
        scope: "project",
        projectSlug: "symphony",
        workspaceMode: "existing",
        workspacePath: "/work/symphony",
        agentKind: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      }),
    ).toEqual({
      scope: "project_session",
      projectSlug: "symphony",
      workspacePath: "/work/symphony",
      agentKind: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      requestKey: "request-123",
    });
  });

  it("ignores stale project fields for freeform sessions", () => {
    expect(
      buildCreateThreadInput({
        ...createInitialNewSessionState(() => "request-123"),
        scope: "free",
        projectSlug: "symphony",
        workspaceMode: "existing",
        workspacePath: "/work/symphony",
        issueIdentifier: "MOB-7",
        branch: "main",
        agentKind: "codex",
      }),
    ).toEqual({
      scope: "freeform",
      agentKind: "codex",
      requestKey: "request-123",
    });
  });

  it("maps isolated and parent issue workspaces explicitly", () => {
    const base = {
      ...createInitialNewSessionState(() => "request-123"),
      scope: "project" as const,
      projectSlug: "symphony",
      issueIdentifier: "MOB-7",
      agentKind: "codex" as const,
    };

    expect(
      buildCreateThreadInput({
        ...base,
        workspaceMode: "isolated",
        branch: "main",
      }),
    ).toEqual({
      scope: "issue_session",
      projectSlug: "symphony",
      issueIdentifier: "MOB-7",
      isolatedWorkspace: true,
      cloneBranch: "main",
      agentKind: "codex",
      requestKey: "request-123",
    });
    expect(
      buildCreateThreadInput({
        ...base,
        workspaceMode: "parent",
      }),
    ).toEqual({
      scope: "issue_session",
      projectSlug: "symphony",
      issueIdentifier: "MOB-7",
      useParentWorkspace: true,
      agentKind: "codex",
      requestKey: "request-123",
    });
  });

  it("rejects blank prompts and derives a title without a title field", () => {
    expect(validateSessionPrompt(" \n ")).toEqual({
      valid: false,
      message: "Write a message to start the session",
    });
    expect(validateSessionPrompt("  Build the mobile flow  ")).toEqual({
      valid: true,
      message: null,
    });

    const longPrompt = `  ${"a".repeat(200)}  `;
    expect(deriveSessionTitle(longPrompt)).toBe("a".repeat(160));
  });

  it("clears invalid dependent context while preserving the prompt", () => {
    const selected = {
      ...createInitialNewSessionState(),
      prompt: "Keep this draft",
      scope: "project" as const,
      projectSlug: "symphony",
      workspaceMode: "isolated" as const,
      workspacePath: "/work/symphony",
      issueIdentifier: "MOB-7",
      branch: "main",
    };

    const changedProject = newSessionReducer(selected, {
      type: "set_project",
      projectSlug: "api",
    });
    expect(changedProject).toMatchObject({
      prompt: "Keep this draft",
      projectSlug: "api",
      workspaceMode: "default",
      workspacePath: null,
      issueIdentifier: null,
      branch: null,
    });

    expect(newSessionReducer(changedProject, { type: "set_scope", scope: "free" })).toMatchObject({
      prompt: "Keep this draft",
      scope: "free",
      projectSlug: null,
      workspaceMode: "default",
      workspacePath: null,
      issueIdentifier: null,
      branch: null,
    });

    const clearedIssue = newSessionReducer(selected, {
      type: "set_issue",
      identifier: null,
    });
    expect(clearedIssue).toMatchObject({
      issueIdentifier: null,
      workspaceMode: "default",
      branch: null,
    });
  });

  it("requires a path when existing workspace mode is selected", () => {
    const state = {
      ...createInitialNewSessionState(),
      prompt: "Build it",
      scope: "project" as const,
      projectSlug: "symphony",
      workspaceMode: "existing" as const,
    };

    expect(validateNewSession(state)).toEqual({
      valid: false,
      message: "Enter the existing workspace path",
    });
    expect(() => buildCreateThreadInput(state)).toThrow("existing workspace path");
  });
});
