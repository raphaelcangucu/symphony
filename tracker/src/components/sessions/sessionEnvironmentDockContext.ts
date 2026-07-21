import { createContext, useContext } from "react";

import type { WorkspaceScope } from "@/lib/workspaceScope";

export interface SessionEnvironmentDockControls {
  /** Workspace scope whose environment dock is currently open, if any. */
  openScope: WorkspaceScope | null;
  /** Opens the dock for the scope, or closes it when it is already open for that scope. */
  toggleEnvironment: (scope: WorkspaceScope) => void;
}

export const SessionEnvironmentDockContext = createContext<SessionEnvironmentDockControls | null>(null);

/**
 * Returns the workspace-level environment dock controls, or null when the session
 * content renders outside a dock-aware workspace (toolbar hides the control).
 */
export function useSessionEnvironmentDock(): SessionEnvironmentDockControls | null {
  return useContext(SessionEnvironmentDockContext);
}
