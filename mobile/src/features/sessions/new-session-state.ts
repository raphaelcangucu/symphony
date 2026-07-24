import type { AgentKind, CreateThreadInput } from "@/api/contracts";

export type NewSessionScope = "free" | "project";
export type WorkspaceMode = "default" | "existing" | "isolated" | "parent";

export type NewSessionState = {
  prompt: string;
  scope: NewSessionScope;
  projectSlug: string | null;
  workspaceMode: WorkspaceMode;
  workspacePath: string | null;
  issueIdentifier: string | null;
  branch: string | null;
  agentKind: AgentKind;
  model: string | null;
  effort: string | null;
};

export type NewSessionAction =
  | { type: "set_prompt"; prompt: string }
  | { type: "set_scope"; scope: NewSessionScope }
  | { type: "set_project"; projectSlug: string | null }
  | { type: "set_workspace"; mode: WorkspaceMode; path?: string | null }
  | { type: "set_issue"; identifier: string | null }
  | { type: "set_branch"; branch: string | null }
  | { type: "set_agent"; agentKind: AgentKind }
  | { type: "set_model"; model: string | null; effort: string | null };

export function createInitialNewSessionState(): NewSessionState {
  return {
    prompt: "",
    scope: "free",
    projectSlug: null,
    workspaceMode: "default",
    workspacePath: null,
    issueIdentifier: null,
    branch: null,
    agentKind: "codex",
    model: null,
    effort: null,
  };
}

export function newSessionReducer(
  state: NewSessionState,
  action: NewSessionAction,
): NewSessionState {
  switch (action.type) {
    case "set_prompt":
      return { ...state, prompt: action.prompt };
    case "set_scope":
      return action.scope === "free"
        ? {
            ...state,
            scope: action.scope,
            projectSlug: null,
            workspaceMode: "default",
            workspacePath: null,
            issueIdentifier: null,
            branch: null,
          }
        : { ...state, scope: action.scope };
    case "set_project":
      return {
        ...state,
        projectSlug: action.projectSlug,
        workspaceMode: "default",
        workspacePath: null,
        issueIdentifier: null,
        branch: null,
      };
    case "set_workspace":
      return {
        ...state,
        workspaceMode: action.mode,
        workspacePath: action.path?.trim() || null,
        branch: action.mode === "isolated" ? state.branch : null,
      };
    case "set_issue":
      return {
        ...state,
        issueIdentifier: action.identifier?.trim() || null,
        branch: action.identifier ? state.branch : null,
      };
    case "set_branch":
      return { ...state, branch: action.branch?.trim() || null };
    case "set_agent":
      return {
        ...state,
        agentKind: action.agentKind,
        model: null,
        effort: null,
      };
    case "set_model":
      return { ...state, model: action.model, effort: action.effort };
  }
}

export function buildCreateThreadInput(state: NewSessionState): CreateThreadInput {
  const settings = {
    agentKind: state.agentKind,
    ...(state.model ? { model: state.model } : {}),
    ...(state.effort ? { effort: state.effort } : {}),
  };
  if (state.scope === "free") {
    return { scope: "freeform", ...settings };
  }
  if (!state.projectSlug) {
    throw new Error("Choose a project");
  }
  if (!state.issueIdentifier) {
    return {
      scope: "project_session",
      projectSlug: state.projectSlug,
      ...(state.workspaceMode === "existing" && state.workspacePath
        ? { workspacePath: state.workspacePath }
        : {}),
      ...settings,
    };
  }

  return {
    scope: "issue_session",
    projectSlug: state.projectSlug,
    issueIdentifier: state.issueIdentifier,
    ...(state.workspaceMode === "existing" && state.workspacePath
      ? { workspacePath: state.workspacePath }
      : {}),
    ...(state.workspaceMode === "isolated" ? { isolatedWorkspace: true } : {}),
    ...(state.workspaceMode === "parent" ? { useParentWorkspace: true } : {}),
    ...(state.workspaceMode === "isolated" && state.branch ? { cloneBranch: state.branch } : {}),
    ...settings,
  };
}

export function validateSessionPrompt(prompt: string): {
  valid: boolean;
  message: string | null;
} {
  return prompt.trim()
    ? { valid: true, message: null }
    : { valid: false, message: "Write a message to start the session" };
}

export function deriveSessionTitle(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").slice(0, 160);
}
